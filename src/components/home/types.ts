import type { ExplainLanguage, ExplanationResult, LabTestResult } from "@/lib/ai/schemas";
import type { PiiSpanKind } from "@/lib/pii";

export interface OcrView {
  ms: number;
  text: string;
  imageUrl: string;
  counts: Partial<Record<PiiSpanKind, number>>;
  /** Batas tabel tidak ditemukan → cloud dinonaktifkan (fail-closed). */
  reviewRequired: boolean;
}

/** Waktu (ms sejak klik) — juga dibaca runner spike lewat data-metrics. */
export interface Metrics {
  ocrMs?: number;
  firstRowMs?: number;
  totalMs?: number;
  rows?: number;
}

/** Baris yang lolos allowlist + guard dan dikirim (atau sedang dikirim) ke cloud. */
export interface Sent {
  rows: number;
  dropped: number;
}

export type ExplainState =
  | { status: "idle" }
  | { status: "blocked"; kinds: readonly string[] }
  /** Payload tidak disusun (mis. tidak ada baris lolos allowlist) — tidak ada request. */
  | { status: "unsent"; message: string }
  | { status: "running"; sent: Sent }
  | {
      status: "done";
      sent: Sent;
      explanation: ExplanationResult;
      rows: readonly LabTestResult[];
      sentIndices: readonly number[];
      language: ExplainLanguage;
    }
  | { status: "error"; sent: Sent; message: string };

export type BusyMode = "device" | "ocr" | "cloud";

export const LANGUAGE_LABEL: Record<ExplainLanguage, string> = { en: "English", id: "Bahasa Indonesia" };
