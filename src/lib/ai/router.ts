"use client";

import type { InferenceSource } from "firebase/ai";
import { assertPayloadClean, type CloudPayload, type KnownPii, type PiiDetection, type PiiSpanKind } from "@/lib/pii";
import { getCloudExplainModel } from "./models";
import { fileToBitmap, openOnDeviceSession } from "./prompt-api";
import {
  flagFromRange,
  fromLeanExtraction,
  type LabExtraction,
  type LabExtractionLean,
  labExtractionLeanJsonSchema,
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

export interface RoutingEvent {
  id: string;
  step: "extract" | "explain";
  location: InferenceSource | "unknown";
  latencyMs: number;
  ok: boolean;
  error?: string;
  stages?: ExtractStages;
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

/** Batas waktu ekstraksi on-device. Run degeneratif tanpa batas berhenti baru setelah ±6 menit (spike). */
export const EXTRACT_TIMEOUT_MS = 60_000;
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
 * Ekstraksi on-device via Prompt API langsung (lihat alasan di prompt-api.ts):
 * gambar ≤1024 px → clone sesi warm → promptStreaming dengan schema ramping, timeout 60 s.
 * Baris hasil di-parse inkremental dari stream dan dikirim lewat onRow.
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
  let bitmap: ImageBitmap | undefined;
  let session: Awaited<ReturnType<typeof openOnDeviceSession>> | undefined;
  try {
    opts.onStage?.("prep");
    bitmap = await fileToBitmap(file);
    stages.prepMs = lap();

    opts.onStage?.("session");
    session = await openOnDeviceSession(ctrl.signal);
    stages.sessionMs = lap();

    opts.onStage?.("prefill");
    const prompt = opts.ocrText
      ? `${EXTRACT_PROMPT}\n\nTeks OCR lokal dari gambar yang sama (bisa salah baca; identitas sudah disensor) sebagai bantuan:\n${opts.ocrText}`
      : EXTRACT_PROMPT;
    const reader = session
      .promptStreaming(
        [{ role: "user", content: [{ type: "text", value: prompt }, { type: "image", value: bitmap }] }],
        { responseConstraint: labExtractionLeanJsonSchema, signal: ctrl.signal },
      )
      .getReader();
    const rows = createResultsStreamParser<Omit<LabTestResult, "flag">>();
    let rowCount = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (stages.prefillMs === undefined) {
        stages.prefillMs = lap();
        opts.onStage?.("generate");
      }
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
    record({ step: "extract", location: "on_device", latencyMs: elapsed(start), ok: true, stages });
    return parsed;
  } catch (e) {
    const err = ctrl.signal.aborted ? ctrl.signal.reason : e;
    record({ step: "extract", location: "on_device", latencyMs: elapsed(start), ok: false, error: errMsg(err), stages });
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
    session?.destroy();
    bitmap?.close();
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
export async function explainInCloud(payload: CloudPayload, known?: KnownPii): Promise<string> {
  const start = performance.now();
  try {
    assertPayloadClean(payload.text, known);
  } catch (e) {
    record({ step: "explain", location: "unknown", latencyMs: elapsed(start), ok: false, error: errMsg(e) });
    throw e;
  }
  try {
    const result = await getCloudExplainModel().generateContent(payload.text);
    record({
      step: "explain",
      location: result.response.inferenceSource ?? "unknown",
      latencyMs: elapsed(start),
      ok: true,
    });
    return result.response.text();
  } catch (e) {
    record({ step: "explain", location: "unknown", latencyMs: elapsed(start), ok: false, error: errMsg(e) });
    throw e;
  }
}
