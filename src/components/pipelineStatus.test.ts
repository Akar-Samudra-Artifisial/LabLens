import { describe, expect, it } from "vitest";
import { type PipelineInput, pipelineSteps } from "./pipelineStatus";

const base: PipelineInput = {
  hasFile: false,
  sample: false,
  sampleLoading: false,
  busy: false,
  busyMode: "device",
  ocrContext: false,
  ocr: null,
  ocrError: false,
  hasResult: false,
  error: false,
  fallback: null,
  extractedInCloud: false,
  cloudLocked: true,
  explain: "idle",
};
const statuses = (p: Partial<PipelineInput>) => pipelineSteps({ ...base, ...p }).map((s) => s.status);
const ocrOk = { reviewRequired: false };

describe("pipelineSteps (status pipeline per fase)", () => {
  it("idle tanpa file: Upload ready, tidak ada yang running", () => {
    expect(statuses({})).toEqual(["ready", "todo", "todo", "todo"]);
  });

  it("sampel sedang dimuat → Upload active", () => {
    expect(statuses({ sampleLoading: true })[0]).toBe("active");
  });

  it("file dipilih, belum diproses → Read ready", () => {
    expect(statuses({ hasFile: true })).toEqual(["done", "ready", "todo", "todo"]);
  });

  it("OCR + Nano berjalan bersamaan → keduanya active, Extract diberi label paralel", () => {
    const steps = pipelineSteps({ ...base, hasFile: true, busy: true });
    expect(steps.map((s) => s.status)).toEqual(["done", "active", "active", "todo"]);
    expect(steps[2].detail).toMatch(/in parallel with OCR/);
  });

  it("OCR sebagai konteks → Extract menunggu OCR (todo), lalu active setelah OCR selesai/gagal", () => {
    const waiting = pipelineSteps({ ...base, hasFile: true, busy: true, ocrContext: true });
    expect(waiting.map((s) => s.status)).toEqual(["done", "active", "todo", "todo"]);
    expect(waiting[2].detail).toMatch(/waits for OCR/);
    expect(statuses({ hasFile: true, busy: true, ocrContext: true, ocr: ocrOk })[2]).toBe("active");
    expect(statuses({ hasFile: true, busy: true, ocrContext: true, ocrError: true })[2]).toBe("active");
  });

  it("mode OCR saja: extract belum berjalan", () => {
    expect(statuses({ hasFile: true, busy: true, busyMode: "ocr" })).toEqual(["done", "active", "todo", "todo"]);
  });

  it("OCR selesai, ekstraksi masih berjalan", () => {
    expect(statuses({ hasFile: true, busy: true, ocr: ocrOk })).toEqual(["done", "done", "active", "todo"]);
  });

  it("fallback cloud menunggu persetujuan → attention; terkunci → blocked", () => {
    expect(statuses({ hasFile: true, ocr: ocrOk, fallback: "ready" })[2]).toBe("attention");
    expect(statuses({ hasFile: true, ocr: { reviewRequired: true }, fallback: "locked" }).slice(1, 3)).toEqual(["attention", "blocked"]);
  });

  it("ekstraksi cloud berjalan → lokasi cloud", () => {
    const steps = pipelineSteps({ ...base, hasFile: true, ocr: ocrOk, busy: true, busyMode: "cloud" });
    expect(steps[2]).toMatchObject({ status: "active", where: "cloud" });
    expect(steps[1].status).toBe("done");
  });

  it("hasil ada → Explain ready, atau blocked bila cloud terkunci", () => {
    expect(statuses({ hasFile: true, ocr: ocrOk, hasResult: true, cloudLocked: false })).toEqual(["done", "done", "done", "ready"]);
    expect(statuses({ hasFile: true, ocr: { reviewRequired: true }, hasResult: true, cloudLocked: true })[3]).toBe("blocked");
  });

  it("explain running/done/blocked guard/error", () => {
    const after = { hasFile: true, ocr: ocrOk, hasResult: true, cloudLocked: false } as const;
    expect(statuses({ ...after, explain: "running" })[3]).toBe("active");
    expect(statuses({ ...after, explain: "done" })[3]).toBe("done");
    expect(statuses({ ...after, explain: "blocked" })[3]).toBe("blocked");
    expect(statuses({ ...after, explain: "error" })[3]).toBe("error");
    expect(statuses({ ...after, explain: "unsent" })[3]).toBe("error");
  });

  it("batal/gagal: sebelum OCR → Read error; sesudah OCR → Extract error; OCR gagal → Read error", () => {
    expect(statuses({ hasFile: true, error: true }).slice(1, 3)).toEqual(["error", "todo"]);
    expect(statuses({ hasFile: true, error: true, ocr: ocrOk }).slice(1, 3)).toEqual(["done", "error"]);
    expect(statuses({ hasFile: true, ocrError: true })[1]).toBe("error");
  });
});
