import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("./models", () => ({
  CLOUD_EXPLAIN_MODEL: "test-model",
  getCloudExplainModel: () => ({ generateContent }),
  getOnDeviceExtractionModel: vi.fn(),
}));
vi.mock("./prompt-api", () => ({ fileToInlineData: vi.fn() }));

import { buildCloudPayload, PiiLeakError } from "../pii";
import { explainInCloud, recordExplainBlocked, type RoutingEvent, subscribeRouting } from "./router";
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
