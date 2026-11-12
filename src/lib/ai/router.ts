"use client";

import { InferenceSource } from "firebase/ai";
import {
  assertFallbackClean,
  assertPayloadClean,
  type CloudPayload,
  fallbackPiiKinds,
  type FallbackPayload,
  type KnownPii,
  type PayloadLanguage,
  payloadPiiKinds,
  type PiiDetection,
  utf8Bytes,
  type PiiSpanKind,
} from "../pii";
import { parseExplanation } from "./explanation";
import { iterateUntilAborted, raceAbort } from "./abortable";
import {
  CLOUD_EXPLAIN_MODEL,
  CLOUD_EXTRACT_MODEL,
  getCloudExplainModel,
  getCloudExtractionModel,
  getOnDeviceExtractionModel,
} from "./models";
import { fileToInlineData } from "./prompt-api";
import {
  flagFromRange,
  fromLeanExtraction,
  type ExplanationResult,
  type LabExtraction,
  type LabExtractionLean,
  type LabTestResult,
  PII_PLACEHOLDERS,
  type PiiKind,
} from "./schemas";
import { createResultsStreamParser } from "./stream-json";

/** Waktu per tahap ekstraksi (ms). prefill = sampai chunk output pertama (baca gambar + prompt). */
export interface ExtractStages {
  prepMs?: number;
  sessionMs?: number;
  prefillMs?: number;
  /** Sejak mulai ekstraksi sampai baris hasil pertama lengkap (streaming). */
  firstRowMs?: number;
  generateMs?: number;
}

/** ok = selesai; error = gagal (timeout, jaringan, respons tak valid); blocked = guard PII menolak, tidak ada request. */
export type RoutingStatus = "ok" | "error" | "blocked";

/** Payload persis yang diteruskan ke SDK (teks sama dengan argumen generateContent / generateContentStream). */
export interface SentPayload {
  step: "extract" | "explain";
  text: string;
  /** Hanya explain (bahasa output); ekstraksi fallback tidak punya pilihan bahasa. */
  language?: PayloadLanguage;
  bytes: number;
  /** Explain: baris hasil yang dikirim. Extract: baris teks OCR termasking yang dikirim. */
  rows: number;
  model: string;
}

export interface RoutingEvent {
  id: string;
  step: "extract" | "explain";
  location: InferenceSource | "unknown";
  latencyMs: number;
  ok: boolean;
  status: RoutingStatus;
  error?: string;
  stages?: ExtractStages;
  /** Byte UTF-8 yang meninggalkan perangkat untuk langkah ini: 0 untuk on-device & diblokir, ukuran payload untuk cloud. */
  bytesSent: number;
  /** Jumlah span PII yang terdeteksi aturan lokal pada dokumen (bila diketahui). */
  piiDetectedLocal?: number;
  /** Jenis PII yang ditemukan guard di payload yang dikirim — 0 bila lolos (tidak pernah dihardcode untuk cloud). */
  piiSent: number;
  /** Hanya explain yang benar-benar dikirim. */
  payload?: SentPayload;
  at: number;
}

type Listener = (events: readonly RoutingEvent[]) => void;

let events: readonly RoutingEvent[] = [];
const listeners = new Set<Listener>();

function record(event: Omit<RoutingEvent, "id" | "at">): void {
  events = [...events, { ...event, id: crypto.randomUUID(), at: Date.now() }];
  listeners.forEach((l) => l(events));
}

export function subscribeRouting(listener: Listener): () => void {
  listeners.add(listener);
  listener(events);
  return () => {
    listeners.delete(listener);
  };
}

// Salinan di spike/shared.mjs (EXTRACT_PROMPT_LEAN) — jaga tetap sinkron.
const EXTRACT_PROMPT =
  "Ekstrak semua baris hasil lab dari gambar ini ke JSON sesuai skema; tulis nama tes, nilai, satuan, " +
  "dan rentang rujukan persis seperti di gambar. Jangan tulis data identitas apa pun; " +
  "di piiKinds cukup sebut jenis data identitas pasien yang terlihat.";

/**
 * Batas waktu ekstraksi on-device. Run degeneratif tanpa batas berhenti baru setelah ±6 menit (spike);
 * run sukses di mesin berbeban tinggi ±56 s, jadi beri ruang.
 */
export const EXTRACT_TIMEOUT_MS = 90_000;
/** Output normal 14 baris ±1,3 rb karakter; jauh di atas ini = output degeneratif (berulang). */
const EXTRACT_MAX_CHARS = 6_000;

const elapsed = (start: number) => Math.round(performance.now() - start);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ExtractStage = "prep" | "session" | "prefill" | "generate";

export interface ExtractOptions {
  signal?: AbortSignal;
  onStage?: (stage: ExtractStage) => void;
  /** Dipanggil begitu satu baris hasil selesai ditulis model (sebelum JSON utuh). */
  onRow?: (row: LabTestResult, index: number) => void;
  /** Teks OCR lokal yang sudah disensor, diberikan ke Nano sebagai konteks tambahan (eksperimen). */
  ocrText?: string;
}

/**
 * Ekstraksi on-device via Firebase AI Logic (`generateContentStream`, mode ONLY_ON_DEVICE, schema ramping):
 * gambar ≤1024 px → stream → baris hasil di-parse inkremental dan dikirim lewat onRow.
 * SDK tidak menerima AbortSignal untuk on-device, jadi timeout/Batal memakai raceAbort: kita berhenti
 * menunggu dan mengabaikan sisa stream (sesi lama dihancurkan SDK saat ekstraksi berikutnya membuat sesi baru).
 */
export async function extractOnDevice(file: File, opts: ExtractOptions = {}): Promise<LabExtraction> {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error(`Format ${file.type || "tidak dikenal"} tidak didukung; pakai JPEG/PNG.`);
  }
  // Sudah dibatalkan sebelum mulai: listener "abort" tidak akan pernah terpanggil → hentikan sekarang.
  opts.signal?.throwIfAborted();
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException(`Ekstraksi melebihi ${EXTRACT_TIMEOUT_MS / 1000} s`, "TimeoutError")),
    EXTRACT_TIMEOUT_MS,
  );
  const onExternalAbort = () => ctrl.abort(new DOMException("Dibatalkan pengguna", "AbortError"));
  opts.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const stages: ExtractStages = {};
  const start = performance.now();
  let mark = start;
  const lap = () => {
    const now = performance.now();
    const ms = Math.round(now - mark);
    mark = now;
    return ms;
  };
  // ONLY_ON_DEVICE: SDK tidak pernah memanggil cloud untuk model ini; ditimpa inferenceSource dari respons bila ada.
  let location: InferenceSource = InferenceSource.ON_DEVICE;
  try {
    opts.onStage?.("prep");
    const inlineData = await raceAbort(fileToInlineData(file), ctrl.signal);
    stages.prepMs = lap();

    // SDK membuat sesi + membaca gambar di dalam satu panggilan; promise selesai saat chunk pertama tiba.
    opts.onStage?.("prefill");
    const prompt = opts.ocrText
      ? `${EXTRACT_PROMPT}\n\nTeks OCR lokal dari gambar yang sama (bisa salah baca; identitas sudah disensor) sebagai bantuan:\n${opts.ocrText}`
      : EXTRACT_PROMPT;
    const result = await raceAbort(
      getOnDeviceExtractionModel().generateContentStream([
        { type: "text", text: prompt },
        { type: "inlineData", inlineData },
      ]),
      ctrl.signal,
    );
    // Agregat internal SDK tidak dipakai; cegah unhandled rejection bila stream ditinggalkan.
    result.response.catch(() => {});
    const rows = createResultsStreamParser<Omit<LabTestResult, "flag">>();
    let rowCount = 0;
    let text = "";
    for await (const chunk of iterateUntilAborted(result.stream, ctrl.signal)) {
      if (stages.prefillMs === undefined) {
        stages.prefillMs = lap();
        opts.onStage?.("generate");
      }
      if (chunk.inferenceSource) location = chunk.inferenceSource;
      const value = chunk.text();
      text += value;
      for (const r of rows.push(value)) {
        stages.firstRowMs ??= elapsed(start);
        opts.onRow?.({ ...r, flag: flagFromRange(String(r.value ?? ""), String(r.referenceRange ?? "")) }, rowCount++);
      }
      if (text.length > EXTRACT_MAX_CHARS) {
        ctrl.abort(new DOMException("Output model terlalu panjang (degeneratif)", "QuotaExceededError"));
      }
    }
    stages.generateMs = lap();

    const parsed = fromLeanExtraction(JSON.parse(text) as LabExtractionLean);
    // On-device: tidak ada request jaringan, jadi tidak ada byte/PII yang keluar.
    record({ step: "extract", location, latencyMs: elapsed(start), ok: true, status: "ok", stages, bytesSent: 0, piiSent: 0 });
    return parsed;
  } catch (e) {
    const err = ctrl.signal.aborted ? ctrl.signal.reason : e;
    record({
      step: "extract",
      location,
      latencyMs: elapsed(start),
      ok: false,
      status: "error",
      error: errMsg(err),
      stages,
      bytesSent: 0,
      piiSent: 0,
    });
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Batas waktu fallback ekstraksi cloud (teks ±1 KB → JSON ±1,5 KB). */
export const CLOUD_EXTRACT_TIMEOUT_MS = 60_000;

export interface CloudExtractOptions {
  signal?: AbortSignal;
  onRow?: (row: LabTestResult, index: number) => void;
  /** Nilai PII dokumen (lokal) — guard dijalankan ulang atas teks final tepat sebelum request. */
  known?: KnownPii;
  piiDetectedLocal?: number;
  /** Percobaan sebelumnya terputus (galat sementara server) — buang baris parsial; `attempt` = nomor request berikutnya. */
  onRetry?: (attempt: number) => void;
}

/**
 * Total request maksimum untuk satu ekstraksi cloud (1 + 3 retry, jeda 1/2/3 s), semuanya di dalam
 * CLOUD_EXTRACT_TIMEOUT_MS. Uji dev: putus beruntun sampai 3× terjadi saat model sedang padat.
 */
export const CLOUD_EXTRACT_MAX_ATTEMPTS = 4;
const CLOUD_EXTRACT_RETRY_DELAY_MS = 1_000;

/**
 * Galat sementara yang aman diulang. Saat model kelebihan beban, backend sering sudah membalas HTTP 200 (SSE) lalu
 * menutup stream dengan JSON `{"error":{"code":500,...}}` mentah (bukan event `data:`); SDK lalu melempar
 * AI/parse-failed "Failed to parse stream". HTTP 429/5xx sebelum stream dimulai → AI/fetch-error.
 */
export function isTransientCloudError(e: unknown): boolean {
  const code = sdkErrorCode(e);
  if (code === "parse-failed") return true;
  if (code === "fetch-error") return [429, 500, 502, 503, 504].includes(sdkHttpStatus(e) ?? 0);
  return false;
}

/** Kode AIError SDK ("parse-failed", "fetch-error", …) tanpa prefiks; undefined untuk galat non-SDK. */
function sdkErrorCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== "string" || !/^AI: /.test(errMsg(e))) return undefined;
  return code.replace(/^AI\//, "");
}

function sdkHttpStatus(e: unknown): number | undefined {
  const status = (e as { customErrorData?: { status?: unknown } }).customErrorData?.status;
  if (typeof status === "number") return status;
  const m = errMsg(e).match(/\[(\d{3})\b/);
  return m ? Number(m[1]) : undefined;
}

const HTTP_TEXT: Readonly<Record<number, string>> = {
  400: "bad request",
  403: "forbidden",
  404: "not found",
  429: "rate limited",
  500: "server error",
  502: "bad gateway",
  503: "service unavailable",
  504: "gateway timeout",
};
const MAX_ERROR_CHARS = 160;

/**
 * Ringkasan galat untuk event routing & UI: galat SDK → kode + status HTTP saja (tanpa URL/body server mentah);
 * galat lain dipotong ke MAX_ERROR_CHARS.
 */
export function cloudErrorSummary(e: unknown): string {
  const code = sdkErrorCode(e);
  if (code === "parse-failed") return "AI/parse-failed (response stream interrupted by the server)";
  if (code) {
    const status = sdkHttpStatus(e);
    return status ? `AI/${code} (HTTP ${status}${HTTP_TEXT[status] ? ` ${HTTP_TEXT[status]}` : ""})` : `AI/${code}`;
  }
  const m = errMsg(e);
  return m.length > MAX_ERROR_CHARS ? `${m.slice(0, MAX_ERROR_CHARS - 1)}…` : m;
}

/** Galat SDK dibungkus ulang dengan pesan ringkas (asli di `cause`); galat lain diteruskan apa adanya. */
function presentable(e: unknown): Error {
  if (sdkErrorCode(e)) return new Error(cloudErrorSummary(e), { cause: e });
  return e instanceof Error ? e : new Error(String(e));
}

/** Jeda yang berhenti (melempar signal.reason) begitu signal aborted; timer dibersihkan. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Fallback dikunci / guard menolak saat menyusun teks (sebelum ada payload) — tidak ada request. Tanpa isi dokumen. */
export function recordExtractBlocked(message: string, opts: Pick<CloudExtractOptions, "piiDetectedLocal"> = {}): void {
  record({
    step: "extract",
    location: InferenceSource.IN_CLOUD,
    piiDetectedLocal: opts.piiDetectedLocal,
    latencyMs: 0,
    ok: false,
    status: "blocked",
    error: `${message} Nothing left the device.`,
    bytesSent: 0,
    piiSent: 0,
  });
}

/** Output model cloud harus `{ results: [...] }` (objek per baris); selain itu error "invalid response" tanpa isi output. */
function parseCloudResults(text: string): LabExtractionLean["results"] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Cloud extraction returned an invalid response (not valid JSON).");
  }
  const results = typeof data === "object" && data !== null ? (data as { results?: unknown }).results : undefined;
  if (!Array.isArray(results) || !results.every((r) => typeof r === "object" && r !== null && !Array.isArray(r))) {
    throw new Error("Cloud extraction returned an invalid response (results is not a list of rows).");
  }
  return results as LabExtractionLean["results"];
}

/**
 * Fallback ekstraksi cloud (persetujuan eksplisit pengguna) saat Gemini Nano tidak tersedia/gagal: hanya TEKS OCR
 * termasking dari `buildFallbackText`, tanpa gambar. Guard dijalankan ulang di sini; cocok → blocked, tidak ada request.
 * Output di-stream dan diproses seperti hasil Nano (flag dihitung lokal dari rentang rujukan).
 */
export async function extractInCloud(fallback: FallbackPayload, opts: CloudExtractOptions = {}): Promise<LabExtraction> {
  const start = performance.now();
  const base = { step: "extract", location: InferenceSource.IN_CLOUD, piiDetectedLocal: opts.piiDetectedLocal } as const;
  try {
    assertFallbackClean(fallback.text, opts.known);
  } catch (e) {
    record({ ...base, latencyMs: elapsed(start), ok: false, status: "blocked", error: errMsg(e), bytesSent: 0, piiSent: 0 });
    throw e;
  }
  opts.signal?.throwIfAborted();
  const piiSent = fallbackPiiKinds(fallback.text, opts.known).length;
  const bytes = utf8Bytes(fallback.text);
  const sent: SentPayload = { step: "extract", text: fallback.text, bytes, rows: fallback.lines, model: CLOUD_EXTRACT_MODEL };
  const sentFields = { bytesSent: bytes, piiSent, payload: sent };

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException(`Cloud extraction took longer than ${CLOUD_EXTRACT_TIMEOUT_MS / 1000} s`, "TimeoutError")),
    CLOUD_EXTRACT_TIMEOUT_MS,
  );
  const onExternalAbort = () => ctrl.abort(new DOMException("Cancelled by the user", "AbortError"));
  opts.signal?.addEventListener("abort", onExternalAbort, { once: true });
  let location: InferenceSource = InferenceSource.IN_CLOUD;
  // Placeholder "Test N" → nama asli dokumen, dipetakan di perangkat (nama asli tidak pernah dikirim).
  const localName = (name: unknown) => {
    const s = String(name ?? "");
    return Object.hasOwn(fallback.localNames, s) ? fallback.localNames[s] : s;
  };
  try {
    // Tiap percobaan = satu request = satu event routing (byte dihitung per request). Payload & guard di atas identik.
    for (let attempt = 1; ; attempt++) {
      const attemptStart = performance.now();
      const stages: ExtractStages = {};
      try {
        const result = await raceAbort(getCloudExtractionModel().generateContentStream(fallback.text, { signal: ctrl.signal }), ctrl.signal);
        result.response.catch(() => {});
        const rows = createResultsStreamParser<Omit<LabTestResult, "flag">>();
        let rowCount = 0;
        let text = "";
        for await (const chunk of iterateUntilAborted(result.stream, ctrl.signal)) {
          stages.prefillMs ??= elapsed(attemptStart);
          if (chunk.inferenceSource) location = chunk.inferenceSource;
          const value = chunk.text();
          text += value;
          for (const r of rows.push(value)) {
            stages.firstRowMs ??= elapsed(attemptStart);
            opts.onRow?.({ ...r, testName: localName(r.testName), flag: flagFromRange(String(r.value ?? ""), String(r.referenceRange ?? "")) }, rowCount++);
          }
          if (text.length > EXTRACT_MAX_CHARS * 2) {
            ctrl.abort(new DOMException("Model output too long (degenerate)", "QuotaExceededError"));
          }
        }
        const results = parseCloudResults(text).map((r) => ({ ...r, testName: localName(r.testName) }));
        const parsed = fromLeanExtraction({ results, piiKinds: [] });
        record({ ...base, ...sentFields, location, latencyMs: elapsed(attemptStart), ok: true, status: "ok", stages });
        return parsed;
      } catch (e) {
        const err = ctrl.signal.aborted ? ctrl.signal.reason : e;
        const retry = !ctrl.signal.aborted && attempt < CLOUD_EXTRACT_MAX_ATTEMPTS && isTransientCloudError(err);
        const summary = cloudErrorSummary(err);
        const message = `${summary}${retry ? ` — retrying (attempt ${attempt}/${CLOUD_EXTRACT_MAX_ATTEMPTS})` : attempt > 1 ? ` (attempt ${attempt}/${CLOUD_EXTRACT_MAX_ATTEMPTS})` : ""}`;
        record({ ...base, ...sentFields, location, latencyMs: elapsed(attemptStart), ok: false, status: "error", error: message, stages });
        if (!retry) {
          if (attempt > 1 && !ctrl.signal.aborted && isTransientCloudError(err)) {
            throw new Error(`The cloud model is busy and cut off its response ${attempt} times (${summary}). Please try again in a moment.`, { cause: err });
          }
          throw presentable(err);
        }
        // Baris parsial percobaan gagal dibuang oleh pemanggil sebelum request berikutnya.
        opts.onRetry?.(attempt + 1);
        const pauseStart = performance.now();
        try {
          await delay(CLOUD_EXTRACT_RETRY_DELAY_MS * attempt, ctrl.signal);
        } catch (abortReason) {
          // Batal/timeout saat jeda: tidak ada request baru (0 byte), tapi timeline harus berakhir dengan alasannya.
          record({ ...base, location, latencyMs: elapsed(pauseStart), ok: false, status: "error", error: `${cloudErrorSummary(abortReason)} (before retry ${attempt + 1}/${CLOUD_EXTRACT_MAX_ATTEMPTS})`, bytesSent: 0, piiSent: 0 });
          throw presentable(abortReason);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

const SPAN_TO_PII_KIND: Readonly<Record<PiiSpanKind, PiiKind>> = {
  name: "name",
  nik: "nik",
  medical_record_number: "medical_record_number",
  date_of_birth: "date_of_birth",
  address: "address",
  phone: "phone",
  date: "other",
  email: "other",
  doctor: "other",
  facility: "other",
  header: "other",
};

/** maskedPii = jenis PII dari aturan lokal (sumber kebenaran) ∪ jenis yang dilaporkan Nano (tambahan). */
export function mergeMaskedPii(extraction: LabExtraction, det: PiiDetection | null): LabExtraction {
  const kinds = new Set<PiiKind>(extraction.maskedPii.map((m) => m.kind));
  for (const s of det?.spans ?? []) kinds.add(SPAN_TO_PII_KIND[s.kind]);
  if (det && det.zoneWords.length > 0) kinds.add("other");
  return { ...extraction, maskedPii: [...kinds].map((kind) => ({ kind, placeholder: PII_PLACEHOLDERS[kind] })) };
}

/**
 * Penjelasan bahasa awam di cloud. Payload WAJIB dari `buildCloudPayload` (allowlist per field: nama tes kanonik
 * dari kamus, nilai/satuan/rentang berpola) dan diperiksa ulang `assertPayloadClean` di sini — cocok → diblokir, tidak ada request.
 */
/**
 * Catat penolakan guard yang terjadi saat MENYUSUN payload (buildCloudPayload → PiiLeakError) — tidak ada request.
 * Hanya jenis PII (kategori) yang dicatat, tidak pernah isi payload.
 */
export function recordExplainBlocked(kinds: readonly string[], opts: ExplainOptions = {}): void {
  record({
    step: "explain",
    location: InferenceSource.IN_CLOUD,
    piiDetectedLocal: opts.piiDetectedLocal,
    latencyMs: 0,
    ok: false,
    status: "blocked",
    error: `Blocked by the PII guard before sending (${kinds.join(", ")}). Nothing left the device.`,
    bytesSent: 0,
    piiSent: 0,
  });
}

export interface ExplainOptions {
  /** Jumlah span PII yang terdeteksi lokal di dokumen — hanya untuk ditampilkan di panel routing. */
  piiDetectedLocal?: number;
}

/**
 * Output divalidasi `parseExplanation` (bentuk salah → ExplanationFormatError, event berstatus error).
 * Mode ONLY_IN_CLOUD: SDK tidak pernah menjalankan model ini di perangkat, jadi lokasi default-nya in_cloud.
 */
export async function explainInCloud(payload: CloudPayload, known?: KnownPii, opts: ExplainOptions = {}): Promise<ExplanationResult> {
  const start = performance.now();
  const base = { step: "explain", location: InferenceSource.IN_CLOUD, piiDetectedLocal: opts.piiDetectedLocal } as const;
  try {
    assertPayloadClean(payload.text, known);
  } catch (e) {
    record({ ...base, latencyMs: elapsed(start), ok: false, status: "blocked", error: errMsg(e), bytesSent: 0, piiSent: 0 });
    throw e;
  }
  // Sesudah guard lulus: hitung ulang dari aturan yang sama atas teks yang akan dikirim (harus 0).
  const piiSent = payloadPiiKinds(payload.text, known).length;
  // Ukuran dihitung ulang dari teks yang benar-benar diteruskan ke SDK, bukan dipercaya dari builder.
  const bytes = utf8Bytes(payload.text);
  const sent: SentPayload = { step: "explain", text: payload.text, language: payload.language, bytes, rows: payload.sentRows, model: CLOUD_EXPLAIN_MODEL };
  const sentFields = { bytesSent: bytes, piiSent, payload: sent };

  let response;
  try {
    ({ response } = await getCloudExplainModel().generateContent(payload.text));
  } catch (e) {
    record({ ...base, ...sentFields, latencyMs: elapsed(start), ok: false, status: "error", error: cloudErrorSummary(e) });
    throw presentable(e);
  }
  const location = response.inferenceSource ?? InferenceSource.IN_CLOUD;
  try {
    const parsed = parseExplanation(response.text());
    record({ ...base, ...sentFields, location, latencyMs: elapsed(start), ok: true, status: "ok" });
    return parsed;
  } catch (e) {
    record({ ...base, ...sentFields, location, latencyMs: elapsed(start), ok: false, status: "error", error: errMsg(e) });
    throw e;
  }
}
