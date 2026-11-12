import type { BusyMode, ExplainState } from "./home/types";
import type { InferenceLocation } from "./LocationTag";
import type { StepItem, StepStatus } from "./Pipeline";

/** State halaman yang menentukan progres pipeline (hanya presentasi; diturunkan dari state yang sudah ada). */
export interface PipelineInput {
  hasFile: boolean;
  sample: boolean;
  sampleLoading: boolean;
  busy: boolean;
  busyMode: BusyMode;
  /** Teks OCR dipakai sebagai konteks Nano → Nano menunggu OCR (tidak paralel). */
  ocrContext: boolean;
  ocr: { reviewRequired: boolean } | null;
  ocrError: boolean;
  hasResult: boolean;
  error: boolean;
  fallback: "ready" | "locked" | null;
  extractedInCloud: boolean;
  cloudLocked: boolean;
  explain: ExplainState["status"];
}

/**
 * Status tiap langkah:
 * - ready   = langkah berikutnya, menunggu aksi pengguna (tidak ada yang berjalan)
 * - active  = sedang berjalan
 * - blocked = sengaja ditahan (cloud terkunci / guard PII) — fail-closed, bukan galat
 * - error   = gagal atau dibatalkan
 */
export function pipelineSteps(s: PipelineInput): StepItem[] {
  const idle = !s.busy && !s.sampleLoading;

  const upload: StepStatus = s.hasFile ? "done" : s.sampleLoading ? "active" : "ready";

  const read: StepStatus = s.ocrError
    ? "error"
    : s.ocr
      ? s.ocr.reviewRequired
        ? "attention"
        : "done"
      : s.busy && s.busyMode !== "cloud"
        ? "active"
        : !s.hasFile
          ? "todo"
          : s.error
            ? "error" // dibatalkan/gagal sebelum OCR selesai
            : idle
              ? "ready"
              : "todo";

  // Mode device (onExtract): Nano berjalan paralel dengan OCR, KECUALI teks OCR dipakai sebagai konteks —
  // saat itu Nano menunggu OCR (selesai atau gagal) sebelum mulai.
  const ocrPending = s.busy && s.busyMode === "device" && !s.ocr && !s.ocrError;
  const waitsForOcr = ocrPending && s.ocrContext;
  const parallel = ocrPending && !s.ocrContext;

  // busyMode tetap "cloud" setelah percobaan cloud selesai (direset hanya oleh ekstraksi baru) → jalur sebenarnya.
  const cloudTried = s.busyMode === "cloud";
  const cloudFailed = cloudTried && !s.busy && !s.hasResult && s.error;

  const extract: StepStatus = s.hasResult
    ? "done"
    : waitsForOcr
      ? "todo"
      : s.busy && s.busyMode !== "ocr"
        ? "active"
        : cloudFailed
          ? "error"
          : s.fallback === "ready"
          ? "attention"
          : s.fallback === "locked"
            ? "blocked"
            : s.error && s.ocr
              ? "error"
              : s.ocr && idle
                ? "ready"
                : "todo";

  const explain: StepStatus =
    s.explain === "done"
      ? "done"
      : s.explain === "running"
        ? "active"
        : s.explain === "blocked"
          ? "blocked"
          : s.explain === "unsent" || s.explain === "error"
            ? "error"
            : !s.hasResult
              ? "todo"
              : s.cloudLocked
                ? "blocked"
                : idle
                  ? "ready"
                  : "todo";

  // Fallback ditawarkan/terkunci (Nano tak tersedia atau gagal) → langkah berikutnya adalah jalur private cloud.
  const extractWhere: InferenceLocation = cloudTried || s.extractedInCloud || s.fallback !== null ? "cloud" : "device";
  const extractStatusText =
    extractWhere !== "cloud" ? undefined : extract === "attention" ? "Needs consent" : extract === "error" ? "Failed" : undefined;
  return [
    { key: "upload", title: "Upload", where: "device", detail: s.hasFile ? (s.sample ? "Sample loaded" : "Image selected") : "Photo or sample", status: upload },
    { key: "read", title: "Read & mask", where: "device", detail: "Local OCR + PII masking", status: read },
    {
      key: "extract",
      title: "Extract",
      where: extractWhere,
      detail:
        extractWhere === "cloud"
          ? "Private cloud · masked text"
          : parallel
            ? "Gemini Nano, in parallel with OCR"
            : waitsForOcr
              ? "Gemini Nano, waits for OCR text"
              : "Gemini Nano on-device",
      status: extract,
      ...(extractStatusText && { statusText: extractStatusText }),
    },
    { key: "explain", title: "Explain", where: "cloud", detail: "Gemini, anonymous rows", status: explain },
  ];
}
