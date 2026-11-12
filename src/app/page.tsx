"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CriticalBanner } from "@/components/CriticalBanner";
import { ExplanationView } from "@/components/ExplanationView";
import { FlagBadge } from "@/components/FlagBadge";
import { MedicalDisclaimer } from "@/components/MedicalDisclaimer";
import type { PayloadPreview } from "@/components/PayloadInspector";
import { RoutingPanel } from "@/components/RoutingPanel";
import { warmUpOnDeviceModel } from "@/lib/ai/models";
import { ON_DEVICE_CREATE_OPTIONS, promptApi } from "@/lib/ai/prompt-api";
import {
  EXTRACT_TIMEOUT_MS,
  type ExtractStage,
  explainInCloud,
  extractOnDevice,
  mergeMaskedPii,
  type RoutingEvent,
  recordExplainBlocked,
  subscribeRouting,
} from "@/lib/ai/router";
import { EXPLAIN_LANGUAGES, type ExplainLanguage, type ExplanationResult, type LabExtraction, type LabTestResult } from "@/lib/ai/schemas";
import { runOcr, warmUpOcr } from "@/lib/ocr/tesseract";
import {
  buildCloudPayload,
  countByKind,
  detectPii,
  type KnownPii,
  knownPiiFrom,
  type PiiDetection,
  PiiLeakError,
  type PiiSpanKind,
  redactText,
  SPAN_KIND_LABEL,
} from "@/lib/pii";
import { redactedImageBlob } from "@/lib/pii/redact-image";
import { createLatestGate } from "@/lib/latest-gate";

async function checkOnDevice(): Promise<string> {
  const api = promptApi();
  if (!api) return "unavailable (no Prompt API — needs desktop Chrome 139+)";
  try {
    return await api.availability(ON_DEVICE_CREATE_OPTIONS);
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STAGE_LABEL: Record<ExtractStage, string> = {
  prep: "preparing image…",
  session: "preparing model…",
  prefill: "reading image…",
  generate: "writing results…",
};

const LANGUAGE_LABEL: Record<ExplainLanguage, string> = { en: "English", id: "Bahasa Indonesia" };

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100";
const BTN_PRIMARY = `rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FOCUS}`;
const BTN_SECONDARY = `rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900 ${FOCUS}`;
const CARD = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const MUTED = "text-zinc-600 dark:text-zinc-400";

interface OcrView {
  ms: number;
  text: string;
  imageUrl: string;
  counts: Partial<Record<PiiSpanKind, number>>;
  /** Batas tabel tidak ditemukan → cloud dinonaktifkan (fail-closed). */
  reviewRequired: boolean;
}

/** Waktu (ms sejak klik) — juga dibaca runner spike lewat data-metrics. */
interface Metrics {
  ocrMs?: number;
  firstRowMs?: number;
  totalMs?: number;
  rows?: number;
}

/** Baris yang lolos allowlist + guard dan dikirim (atau sedang dikirim) ke cloud. */
interface Sent {
  rows: number;
  dropped: number;
}

type ExplainState =
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

export default function Home() {
  const [availability, setAvailability] = useState("checking…");
  const [warm, setWarm] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ExtractStage | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [ocrContext, setOcrContext] = useState(false);
  const [ocr, setOcr] = useState<OcrView | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [rows, setRows] = useState<LabTestResult[]>([]);
  /** Alasan bila baris yang tampil hanya parsial (timeout/Batal/gagal di tengah streaming). */
  const [partial, setPartial] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({});
  const [result, setResult] = useState<LabExtraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<ExplainState>({ status: "idle" });
  const [language, setLanguage] = useState<ExplainLanguage>("en");
  const [events, setEvents] = useState<readonly RoutingEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Respons Explain dari dokumen/permintaan sebelumnya diabaikan (Extract baru membuat token lama usang).
  const [explainGate] = useState(createLatestGate);
  // Nilai PII asli dokumen aktif — hanya di memori tab ini, dipakai guard sebelum cloud.
  const [known, setKnown] = useState<KnownPii | null>(null);

  useEffect(() => {
    checkOnDevice().then((a) => {
      setAvailability(a);
      // Muat model lebih awal lewat SDK (create cold ±12–16 s) agar tidak terjadi saat klik pertama.
      // Saat "downloadable", unduhan butuh user activation → model dimuat saat klik Extract.
      if (a === "available") {
        const t = performance.now();
        warmUpOnDeviceModel().then(
          () => setWarm(`ready (${Math.round(performance.now() - t)} ms)`),
          (e: unknown) => setWarm(`failed: ${errText(e)}`),
        );
      }
    });
    warmUpOcr().catch((e: unknown) => setOcrError(`OCR failed to load: ${errText(e)}`));
    return subscribeRouting(setEvents);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedS(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => () => {
    if (ocr) URL.revokeObjectURL(ocr.imageUrl);
  }, [ocr]);

  async function onExtract() {
    if (!file || explain.status === "running") return;
    explainGate.invalidate();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    setKnown(null);
    setBusy(true);
    setElapsedS(0);
    setError(null);
    setOcrError(null);
    setOcr(null);
    setRows([]);
    setPartial(null);
    setResult(null);
    setMetrics({});
    setExplain({ status: "idle" });

    try {
      // OCR + aturan PII (lokal, deterministik) — selesai lebih dulu, teks tersensor langsung tampil.
      const ocrP = runOcr(file, ctrl.signal).then(async (o) => {
        try {
          const det = detectPii(o.page);
          const blob = await redactedImageBlob(o.image, o.page, det);
          const text = redactText(o.page, det);
          setKnown(knownPiiFrom(o.page, det));
          setOcr({ ms: o.ms, text, imageUrl: URL.createObjectURL(blob), counts: countByKind(det), reviewRequired: det.reviewRequired });
          setMetrics((m) => ({ ...m, ocrMs: since() }));
          return { det, text };
        } finally {
          o.image.close();
        }
      });
      // Ekstraksi Nano: paralel dengan OCR, kecuali teks OCR dipakai sebagai konteks. OCR gagal tidak
      // menggagalkan Nano — Nano jalan tanpa konteks.
      let streamed = 0;
      const nanoP = (async () => {
        const ocrText = ocrContext ? await ocrP.then((o) => o.text).catch(() => undefined) : undefined;
        return extractOnDevice(file, {
          signal: ctrl.signal,
          onStage: setStage,
          ocrText,
          onRow: (row) => {
            streamed++;
            setMetrics((m) => (m.firstRowMs === undefined ? { ...m, firstRowMs: since() } : m));
            setRows((prev) => [...prev, row]);
          },
        });
      })();

      const [ocrRes, nanoRes] = await Promise.allSettled([ocrP, nanoP]);
      let det: PiiDetection | null = null;
      if (ocrRes.status === "fulfilled") det = ocrRes.value.det;
      else setOcrError(`OCR failed: ${errText(ocrRes.reason)} — cloud explanation disabled.`);
      if (nanoRes.status === "fulfilled") {
        const merged = mergeMaskedPii(nanoRes.value, det);
        setResult(merged);
        setRows(merged.results);
        setMetrics((m) => ({ ...m, totalMs: since(), rows: merged.results.length }));
      } else {
        setError(errText(nanoRes.reason));
        if (streamed > 0) setPartial(`${errText(nanoRes.reason)} — ${streamed} partial rows, not validated, not sent to the cloud`);
        setMetrics((m) => ({ ...m, totalMs: since() }));
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      abortRef.current = null;
      setStage(null);
      setBusy(false);
    }
  }

  /** Cloud hanya boleh dipakai bila OCR + aturan PII berhasil dan batas tabel ditemukan (fail-closed). */
  const cloudLocked = !known || !ocr || ocr.reviewRequired;
  const piiDetectedLocal = ocr ? Object.values(ocr.counts).reduce((n, c) => n + (c ?? 0), 0) : null;

  /** Pratinjau = buildCloudPayload yang sama dengan onExplain (allowlist + guard), untuk Inspect sebelum kirim. */
  const preview = useMemo<PayloadPreview>(() => {
    if (!result) return { state: "unavailable", reason: "Read a report first. The payload is built from the extracted rows." };
    if (cloudLocked || !known) return { state: "unavailable", reason: "Cloud is disabled for this document (local PII check incomplete)." };
    try {
      return { state: "ready", payload: buildCloudPayload(result.results, known, language) };
    } catch (e) {
      return e instanceof PiiLeakError ? { state: "blocked", kinds: e.kinds } : { state: "empty", message: errText(e) };
    }
  }, [result, known, cloudLocked, language]);

  async function onExplain() {
    if (!result || !known || cloudLocked || busy) return;
    const token = explainGate.next();
    const opts = { piiDetectedLocal: piiDetectedLocal ?? undefined };
    // Disusun ulang saat klik (bukan memakai pratinjau) agar guard selalu berjalan atas data terbaru.
    let payload;
    try {
      payload = buildCloudPayload(result.results, known, language);
    } catch (e) {
      if (e instanceof PiiLeakError) {
        recordExplainBlocked(e.kinds, opts); // timeline: hanya kategori, tanpa isi payload
        setExplain({ status: "blocked", kinds: e.kinds });
      } else {
        setExplain({ status: "unsent", message: errText(e) });
      }
      return;
    }
    const sent = { rows: payload.sentRows, dropped: payload.droppedRows };
    const snapshot = result.results;
    const sentIndices = payload.sentIndices;
    setExplain({ status: "running", sent });
    try {
      const explanation = await explainInCloud(payload, known, opts);
      if (!explainGate.isCurrent(token)) return; // dokumen sudah berganti — respons usang diabaikan
      setExplain({ status: "done", sent, explanation, rows: snapshot, sentIndices, language: payload.language });
    } catch (e) {
      if (!explainGate.isCurrent(token)) return;
      setExplain(e instanceof PiiLeakError ? { status: "blocked", kinds: e.kinds } : { status: "error", sent, message: errText(e) });
    }
  }

  const badge =
    explain.status === "blocked"
      ? { cls: "bg-red-700", text: "Blocked — PII detected, nothing was sent" }
      : explain.status === "error"
        ? { cls: "bg-amber-700", text: `Guard passed (${explain.sent.rows} rows, no PII) — cloud request failed` }
        : explain.status === "running" || explain.status === "done"
          ? {
              cls: "bg-emerald-800",
              text: `Guard passed — ${explain.sent.rows} rows without PII sent to the cloud${explain.sent.dropped ? ` (${explain.sent.dropped} kept local)` : ""}`,
            }
          : cloudLocked && (ocr || ocrError)
            ? { cls: "bg-amber-700", text: "Cloud disabled — review manually" }
            : { cls: "bg-zinc-600", text: "Nothing sent to the cloud yet" };

  const fmtS = (ms?: number) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const explainDisabled = !result || cloudLocked || busy || explain.status === "running";

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-4 font-sans sm:p-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">LabLens</h1>
          <p className={`text-sm ${MUTED}`}>
            Your lab report is read on this device. Only anonymous test rows go to the cloud for a plain-language explanation.
          </p>
          <p className="text-xs">
            Gemini Nano: <code className="font-mono">{availability}</code>
            {warm && (
              <>
                {" "}
                · model: <code className="font-mono">{warm}</code>
              </>
            )}
          </p>
        </header>

        <section aria-labelledby="upload-heading" className={`${CARD} flex flex-col gap-3`}>
          <h2 id="upload-heading" className="font-medium">
            1 · Read report on device
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>Lab report image (JPEG or PNG)</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                className={`text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700 ${FOCUS}`}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button type="button" className={BTN_PRIMARY} disabled={!file || busy || explain.status === "running"} onClick={onExtract}>
              {busy ? "Reading…" : "Extract (on-device)"}
            </button>
            {busy && (
              <button type="button" className={BTN_SECONDARY} onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={ocrContext} disabled={busy} onChange={(e) => setOcrContext(e.target.checked)} />
            give redacted OCR text to Nano as context (experimental)
          </label>
          <p className="text-sm" aria-live="polite">
            {busy && (
              <>
                {ocr ? "OCR done · " : "Local OCR… · "}
                {stage ? STAGE_LABEL[stage] : "starting…"} {elapsedS} s / max {EXTRACT_TIMEOUT_MS / 1000} s
              </>
            )}
          </p>
          <p className={`font-mono text-xs ${MUTED}`} data-testid="metrics" data-metrics={JSON.stringify(metrics)}>
            OCR+redact {fmtS(metrics.ocrMs)} · first row {fmtS(metrics.firstRowMs)} · total {fmtS(metrics.totalMs)}
          </p>
          {error && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          {ocrError && (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {ocrError}
            </p>
          )}
        </section>

        <section className={CARD} data-testid="redacted-panel" aria-labelledby="redacted-heading">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="redacted-heading" className="font-medium">
              Redacted on device
            </h2>
            <span className={`rounded px-2 py-0.5 text-xs text-white ${badge.cls}`} data-testid="cloud-badge">
              {badge.text}
            </span>
          </div>
          {ocr?.reviewRequired && (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300" role="alert">
              The results table boundary was not found, so the report header (name, ID number, etc.) cannot be confirmed as
              redacted. Cloud explanation is disabled for this document — check the redacted image manually.
            </p>
          )}
          {!ocr && <p className={`mt-2 text-sm ${MUTED}`}>{busy ? "OCR and PII rules running on this device…" : "No document yet."}</p>}
          {ocr && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL lokal, bukan aset Next */}
              <img src={ocr.imageUrl} alt="Preview of the redacted report image" className="w-full rounded border border-zinc-200 dark:border-zinc-800" />
              <div className="flex flex-col gap-2 text-xs">
                <p>
                  OCR + redaction: {ocr.ms} ms · PII by kind:{" "}
                  {Object.entries(ocr.counts)
                    .map(([k, n]) => `${SPAN_KIND_LABEL[k as PiiSpanKind]} ${n}`)
                    .join(" · ") || "none"}
                </p>
                <pre
                  tabIndex={0}
                  aria-label="Redacted OCR text"
                  className={`max-h-72 overflow-auto rounded bg-zinc-100 p-2 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 ${FOCUS}`}
                  data-testid="redacted-text"
                >
                  {ocr.text}
                </pre>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="results-heading" className={`${CARD} flex flex-col gap-3`}>
          <h2 id="results-heading" className="font-medium">
            Results {busy && rows.length > 0 && <span className={`text-sm font-normal ${MUTED}`}>(streaming…)</span>}
          </h2>
          {/* Dari flag lokal — tampil apa pun status cloud (terkunci/offline/gagal); ExplanationView tidak mengulangnya. */}
          <CriticalBanner rows={rows} />
          {partial && (
            <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="partial">
              Partial: {partial}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className={`w-full text-left text-sm ${partial ? "italic opacity-60" : ""}`} data-testid="rows">
              <caption className="sr-only">Extracted lab results with locally computed flags</caption>
              <thead className={`text-xs ${MUTED}`}>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Test</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Result</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Unit</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Reference</th>
                  <th scope="col" className="py-1.5 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className={`py-2 ${MUTED}`}>
                      No rows yet.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="py-1.5 pr-3">{r.testName}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.value}</td>
                    <td className="py-1.5 pr-3">{r.unit}</td>
                    <td className="py-1.5 pr-3">{r.referenceRange}</td>
                    <td className="py-1.5">
                      <FlagBadge flag={r.flag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && <MedicalDisclaimer />}
        </section>

        <section aria-labelledby="explain-heading" className={`${CARD} flex flex-col gap-3`}>
          <h2 id="explain-heading" className="font-medium">
            2 · Explain in plain language (cloud)
          </h2>
          <fieldset className="flex flex-wrap items-center gap-3 text-sm" disabled={explain.status === "running"}>
            <legend className="sr-only">Explanation language</legend>
            <span aria-hidden="true" className={MUTED}>
              Language:
            </span>
            {EXPLAIN_LANGUAGES.map((l) => (
              <label key={l} className="flex items-center gap-1.5">
                <input type="radio" name="explain-language" value={l} checked={language === l} onChange={() => setLanguage(l)} />
                {LANGUAGE_LABEL[l]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={explainDisabled} onClick={onExplain}>
              {explain.status === "running" ? "Explaining…" : "Explain (cloud)"}
            </button>
            <span className={`text-xs ${MUTED}`}>
              Only rows with a known test name and a plain value/unit/range are sent, and the PII guard checks them again.
              Open “Inspect cloud payload” to see the exact text first.
            </span>
          </div>
          <div aria-live="polite">
            {explain.status === "running" && <p className={`text-sm ${MUTED}`}>Asking Gemini in the cloud…</p>}
            {explain.status === "blocked" && (
              <p className="text-sm text-red-700 dark:text-red-400" role="alert">
                Blocked before sending: the payload still contained identity data ({explain.kinds.join(", ")}). Nothing left the device.
              </p>
            )}
            {(explain.status === "error" || explain.status === "unsent") && (
              <p className="text-sm text-red-700 dark:text-red-400" role="alert">
                {explain.message}
              </p>
            )}
          </div>
          {explain.status === "done" && (
            <ExplanationView explanation={explain.explanation} rows={explain.rows} sentIndices={explain.sentIndices} language={explain.language} />
          )}
        </section>

        <details className={CARD}>
          <summary className={`cursor-pointer text-sm font-medium ${FOCUS}`}>Extraction JSON (debug)</summary>
          <pre className="mt-2 overflow-auto rounded bg-zinc-100 p-3 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" data-testid="result-json">
            {result ? JSON.stringify(result, null, 2) : "—"}
          </pre>
        </details>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-8">
        <RoutingPanel events={events} piiDetectedLocal={piiDetectedLocal} preview={preview} rows={rows} />
      </aside>
    </main>
  );
}
