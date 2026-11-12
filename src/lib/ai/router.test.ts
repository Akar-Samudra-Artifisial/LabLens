import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();
vi.mock("./models", () => ({
  CLOUD_EXPLAIN_MODEL: "test-model",
  CLOUD_EXTRACT_MODEL: "test-extract-model",
  getCloudExplainModel: () => ({ generateContent }),
  getCloudExtractionModel: () => ({ generateContentStream }),
  getOnDeviceExtractionModel: vi.fn(),
}));
vi.mock("./prompt-api", () => ({ fileToInlineData: vi.fn() }));

import { buildCloudPayload, FALLBACK_EXTRACT_PROMPT, type FallbackPayload, PiiLeakError } from "../pii";
import { cloudErrorSummary, explainInCloud, extractInCloud, isTransientCloudError, recordExplainBlocked, recordExtractBlocked, type RoutingEvent, subscribeRouting } from "./router";
import type { LabTestResult } from "./schemas";

const okResponse = {
  summary: "Fine.",
  perTest: [{ testName: "Hemoglobin", explanation: "Carries oxygen." }],
  doctorQuestions: ["Q1?", "Q2?", "Q3?"],
  disclaimer: "x",
};

let latest: readonly RoutingEvent[] = [];
subscribeRouting((e) => {
  latest = e;
});
const last = () => latest[latest.length - 1];

const rows: LabTestResult[] = [{ testName: "Hemoglobin", value: "11.2", unit: "g/dL", referenceRange: "13.0-17.0", flag: "low" }];

beforeEach(() => {
  generateContent.mockReset();
  generateContent.mockResolvedValue({ response: { text: () => JSON.stringify(okResponse), inferenceSource: undefined } });
});

describe("explainInCloud — bytesSent", () => {
  it("dihitung ulang dari payload.text (UTF-8), bukan nilai builder", async () => {
    const base = buildCloudPayload(rows, undefined, "en");
    const text = `${base.text} µ±`; // karakter multi-byte: panjang string ≠ byte UTF-8
    await explainInCloud({ ...base, text, bytes: 1 });
    const expected = new TextEncoder().encode(text).length;
    expect(expected).toBeGreaterThan(text.length);
    expect(last().bytesSent).toBe(expected);
    expect(last().payload?.bytes).toBe(expected);
    expect(last().piiSent).toBe(0);
    expect(generateContent).toHaveBeenCalledWith(text);
  });
});

function fallbackOf(masked: string, localNames: Record<string, string> = {}): FallbackPayload {
  const text = FALLBACK_EXTRACT_PROMPT + masked;
  return { text, maskedText: masked, bytes: new TextEncoder().encode(text).length, lines: masked.split("\n").length, droppedLines: 0, localNames };
}

function streamOf(parts: string[]) {
  return {
    stream: (async function* () {
      for (const p of parts) yield { text: () => p, inferenceSource: undefined };
    })(),
    response: Promise.resolve({}),
  };
}

describe("extractInCloud (fallback teks termasking)", () => {
  beforeEach(() => generateContentStream.mockReset());

  it("guard lulus → stream, baris + flag lokal, event in_cloud extract dengan bytes & piiSent 0", async () => {
    const fb = fallbackOf("Hemoglobin 10.2 L g/dL 12.0 - 16.0\nMCV 80.8 fL 80-100");
    generateContentStream.mockResolvedValue(
      streamOf([
        '{"results":[{"testName":"Hemoglobin","value":"10.2","unit":"g/dL","referenceRange":"12.0 - 16.0"},',
        '{"testName":"MCV","value":"80.8","unit":"fL","referenceRange":"80 - 100"}]}',
      ]),
    );
    const onRow = vi.fn();
    const res = await extractInCloud(fb, { onRow });
    expect(generateContentStream).toHaveBeenCalledWith(fb.text, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // Hanya string teks: tidak ada part gambar (inlineData) yang bisa ikut terkirim.
    expect(typeof generateContentStream.mock.calls[0][0]).toBe("string");
    expect(onRow).toHaveBeenCalledTimes(2);
    expect(res.results.map((r) => r.flag)).toEqual(["low", "normal"]);
    expect(last()).toMatchObject({ step: "extract", location: "in_cloud", status: "ok", bytesSent: fb.bytes, piiSent: 0 });
    expect(last().payload).toMatchObject({ step: "extract", text: fb.text, model: "test-extract-model", rows: 2 });
  });

  it("guard menolak (PII di teks) → blocked, tanpa request", async () => {
    const fb = fallbackOf("Hemoglobin 10.2 g/dL 12.0 - 16.0\nNIK 3174012345678901");
    await expect(extractInCloud(fb)).rejects.toBeInstanceOf(PiiLeakError);
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ step: "extract", location: "in_cloud", status: "blocked", bytesSent: 0, piiSent: 0 });
    expect(last().payload).toBeUndefined();
  });

  it("nilai PII dokumen (known) → blocked, tanpa request", async () => {
    const fb = fallbackOf("Hemoglobin 10.2 g/dL 12.0 - 16.0 Rahmawati");
    await expect(extractInCloud(fb, { known: { phrases: [], tokens: ["Rahmawati"] } })).rejects.toBeInstanceOf(PiiLeakError);
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(last().status).toBe("blocked");
  });

  it("placeholder Test N dipetakan balik ke nama asli secara lokal (onRow + hasil akhir)", async () => {
    const fb = fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0\nTest 1 | 3.2 | | 1 - 3", { "Test 1": "NLR" });
    generateContentStream.mockResolvedValue(
      streamOf([
        '{"results":[{"testName":"Hemoglobin","value":"10.2","unit":"g/dL","referenceRange":"12.0 - 16.0"},',
        '{"testName":"Test 1","value":"3.2","unit":"","referenceRange":"1 - 3"}]}',
      ]),
    );
    const onRow = vi.fn();
    const res = await extractInCloud(fb, { onRow });
    expect(generateContentStream.mock.calls[0][0]).not.toContain("NLR");
    expect(onRow.mock.calls.map((c) => c[0].testName)).toEqual(["Hemoglobin", "NLR"]);
    expect(res.results.map((r) => r.testName)).toEqual(["Hemoglobin", "NLR"]);
  });

  it("Cancel saat stream menggantung → AbortError, event error, onRow hanya baris yang sudah diterima", async () => {
    const fb = fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0");
    generateContentStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => '{"results":[{"testName":"Hemoglobin","value":"10.2","unit":"g/dL","referenceRange":"12.0 - 16.0"},', inferenceSource: undefined };
        await new Promise(() => {}); // server berhenti mengirim
      })(),
      response: new Promise(() => {}),
    });
    const ctrl = new AbortController();
    const onRow = vi.fn(() => ctrl.abort());
    await expect(extractInCloud(fb, { signal: ctrl.signal, onRow })).rejects.toMatchObject({ name: "AbortError" });
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ step: "extract", status: "error", ok: false, error: "Cancelled by the user" });
  });

  it("sudah dibatalkan sebelum request → tidak ada request", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"), { signal: ctrl.signal })).rejects.toBeDefined();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it("error stream di tengah → error diteruskan, event error", async () => {
    generateContentStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => '{"results":[', inferenceSource: undefined };
        throw new Error("network reset");
      })(),
      response: Promise.reject(new Error("network reset")),
    });
    await expect(extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"))).rejects.toThrow("network reset");
    expect(last()).toMatchObject({ step: "extract", status: "error", error: "network reset" });
  });

  const sdkError = (code: string, message: string) => Object.assign(new Error(`AI: ${message} (AI/${code})`), { code });
  const brokenStream = (err: Error) => {
    const response = Promise.reject(err);
    response.catch(() => {});
    return {
      stream: (async function* () {
        yield { text: () => '{"results":[{"testName":"Hemoglobin","value":"10.2","unit":"g/dL","referenceRange":"12.0 - 16.0"},', inferenceSource: undefined };
        throw err;
      })(),
      response,
    };
  };
  const okStream = () =>
    streamOf(['{"results":[{"testName":"Hemoglobin","value":"10.2","unit":"g/dL","referenceRange":"12.0 - 16.0"}]}']);

  it("stream diputus server (AI/parse-failed) → retry dengan payload sama, tiap request 1 event, baris parsial di-reset", async () => {
    vi.useFakeTimers();
    try {
      const fb = fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0");
      generateContentStream.mockResolvedValueOnce(brokenStream(sdkError("parse-failed", "Failed to parse stream"))).mockResolvedValueOnce(okStream());
      const onRetry = vi.fn();
      const before = latest.length;
      const p = extractInCloud(fb, { onRetry });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.results).toHaveLength(1);
      expect(generateContentStream).toHaveBeenCalledTimes(2);
      expect(generateContentStream.mock.calls.map((c) => c[0])).toEqual([fb.text, fb.text]);
      expect(onRetry).toHaveBeenCalledWith(2);
      const evs = latest.slice(before);
      expect(evs.map((e) => e.status)).toEqual(["error", "ok"]);
      expect(evs.every((e) => e.bytesSent === fb.bytes && e.piiSent === 0)).toBe(true);
      expect(evs[0].error).toMatch(/retrying \(attempt 1\/4\)/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("galat sementara terus-menerus → berhenti setelah 4 request, error diteruskan", async () => {
    vi.useFakeTimers();
    try {
      generateContentStream.mockImplementation(async () => brokenStream(sdkError("fetch-error", "Error fetching from x: [503 ] busy")));
      const before = latest.length;
      const p = extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"));
      const assertion = expect(p).rejects.toThrow(/busy and cut off its response 4 times \(AI\/fetch-error \(HTTP 503 service unavailable\)\)/);
      await vi.runAllTimersAsync();
      await assertion;
      expect(generateContentStream).toHaveBeenCalledTimes(4);
      expect(latest.slice(before).map((e) => e.status)).toEqual(["error", "error", "error", "error"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Batal saat jeda retry → event abort tercatat (0 byte), timer jeda dibersihkan, tidak ada request baru", async () => {
    vi.useFakeTimers();
    try {
      generateContentStream.mockResolvedValueOnce(brokenStream(sdkError("parse-failed", "Failed to parse stream")));
      const ctrl = new AbortController();
      const before = latest.length;
      const p = extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"), { signal: ctrl.signal, onRetry: () => queueMicrotask(() => ctrl.abort()) });
      const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(0);
      await assertion;
      expect(generateContentStream).toHaveBeenCalledTimes(1);
      const evs = latest.slice(before);
      expect(evs.map((e) => e.status)).toEqual(["error", "error"]);
      expect(evs[1]).toMatchObject({ bytesSent: 0, piiSent: 0, error: "Cancelled by the user (before retry 2/4)" });
      expect(vi.getTimerCount()).toBe(0); // jeda retry + timeout total sudah dibersihkan
    } finally {
      vi.useRealTimers();
    }
  });

  it("galat SDK diringkas ke kode + status HTTP (tanpa URL/body server) di event & error", async () => {
    const raw = sdkError("fetch-error", 'Error fetching from https://x.example/v1/models:streamGenerateContent?key=SECRET: [403 ] {"error":{"message":"App Check token invalid","details":"…"}}');
    generateContentStream.mockRejectedValueOnce(raw);
    await expect(extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"))).rejects.toThrow(/^AI\/fetch-error \(HTTP 403 forbidden\)$/);
    expect(last().error).toBe("AI/fetch-error (HTTP 403 forbidden)");
    expect(cloudErrorSummary(sdkError("parse-failed", "Failed to parse stream"))).toBe("AI/parse-failed (response stream interrupted by the server)");
    expect(cloudErrorSummary(new Error("x".repeat(500))).length).toBeLessThanOrEqual(160);

    generateContent.mockRejectedValueOnce(raw);
    await expect(explainInCloud(buildCloudPayload(rows, undefined, "en"))).rejects.toThrow(/^AI\/fetch-error \(HTTP 403 forbidden\)$/);
    expect(last()).toMatchObject({ step: "explain", status: "error", error: "AI/fetch-error (HTTP 403 forbidden)" });
  });

  it("isTransientCloudError: hanya parse-failed & fetch-error 429/5xx", () => {
    expect(isTransientCloudError(sdkError("parse-failed", "Failed to parse stream"))).toBe(true);
    expect(isTransientCloudError(sdkError("fetch-error", "Error fetching from x: [500 ] y"))).toBe(true);
    expect(isTransientCloudError(sdkError("fetch-error", "Error fetching from x: [403 ] App Check"))).toBe(false);
    expect(isTransientCloudError(new Error("network reset"))).toBe(false);
    expect(isTransientCloudError(new DOMException("x", "AbortError"))).toBe(false);
  });

  it.each([
    ["bukan JSON", ['{"results":[{"testName":"Hb"'], /not valid JSON/],
    ["results bukan array", ['{"results":{"testName":"Hb"}}'], /results is not a list/],
    ["results berisi non-objek", ['{"results":["Hb 10"]}'], /results is not a list/],
  ] as const)("JSON tidak valid (%s) → error invalid response", async (_label, parts, re) => {
    generateContentStream.mockResolvedValue(streamOf([...parts]));
    await expect(extractInCloud(fallbackOf("Hemoglobin | 10.2 | g/dL | 12.0 - 16.0"))).rejects.toThrow(re);
    expect(last()).toMatchObject({ step: "extract", status: "error" });
    expect(String(last().error)).toMatch(/invalid response/);
  });

  it("recordExtractBlocked → event blocked extract tanpa payload", () => {
    recordExtractBlocked("Locked.", { piiDetectedLocal: 3 });
    expect(last()).toMatchObject({ step: "extract", location: "in_cloud", status: "blocked", bytesSent: 0, piiDetectedLocal: 3 });
    expect(last().payload).toBeUndefined();
  });
});

describe("event routing blocked", () => {
  it("guard menolak saat kirim → event blocked, tanpa request & tanpa payload", async () => {
    const base = buildCloudPayload(rows, undefined, "en");
    const dirty = `${base.text} NIK 3174012345678901`;
    await expect(explainInCloud({ ...base, text: dirty })).rejects.toBeInstanceOf(PiiLeakError);
    expect(generateContent).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ step: "explain", status: "blocked", ok: false, bytesSent: 0, piiSent: 0 });
    expect(last().payload).toBeUndefined();
  });

  it("recordExplainBlocked (blokir di buildCloudPayload) → hanya kategori, tanpa isi payload", () => {
    const before = latest.length;
    recordExplainBlocked(["nik", "phone"], { piiDetectedLocal: 7 });
    expect(latest).toHaveLength(before + 1);
    const e = last();
    expect(e).toMatchObject({ step: "explain", status: "blocked", ok: false, bytesSent: 0, piiSent: 0, piiDetectedLocal: 7 });
    expect(e.payload).toBeUndefined();
    expect(e.error).toContain("nik, phone");
    expect(e.error).not.toMatch(/\d{6,}/);
  });
});
