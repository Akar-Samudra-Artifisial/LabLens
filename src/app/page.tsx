"use client";

import { useEffect, useRef, useState } from "react";
import { ON_DEVICE_CREATE_OPTIONS, promptApi, warmUpOnDevice } from "@/lib/ai/prompt-api";
import {
  EXTRACT_TIMEOUT_MS,
  type ExtractStage,
  explainInCloud,
  extractOnDevice,
  mergeMaskedPii,
  type RoutingEvent,
  subscribeRouting,
} from "@/lib/ai/router";
import type { LabExtraction, LabTestResult } from "@/lib/ai/schemas";
import { runOcr, warmUpOcr } from "@/lib/ocr/tesseract";
import {
  buildCloudPayload,
  type CloudPayload,
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

async function checkOnDevice(): Promise<string> {
  const api = promptApi();
  if (!api) return "unavailable (Prompt API tidak ada — perlu Chrome Desktop 139+)";
  try {
    return await api.availability(ON_DEVICE_CREATE_OPTIONS);
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STAGE_LABEL: Record<ExtractStage, string> = {
  prep: "menyiapkan gambar…",
  session: "menyiapkan model…",
  prefill: "membaca gambar…",
  generate: "menulis hasil…",
};

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
  | { status: "done"; sent: Sent; text: string }
  | { status: "error"; sent: Sent; message: string };

export default function Home() {
  const [availability, setAvailability] = useState("memeriksa…");
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
  const [events, setEvents] = useState<readonly RoutingEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Nilai PII asli dokumen aktif — hanya di memori tab ini, dipakai guard sebelum cloud.
  const [known, setKnown] = useState<KnownPii | null>(null);

  useEffect(() => {
    checkOnDevice().then((a) => {
      setAvailability(a);
      // Muat model lebih awal (create cold ±12–16 s) agar tidak terjadi saat klik pertama.
      // Saat "downloadable", create() butuh user activation → warm-up terjadi saat klik.
      if (a === "available") {
        const t = performance.now();
        warmUpOnDevice().then(
          () => setWarm(`siap (${Math.round(performance.now() - t)} ms)`),
          (e: unknown) => setWarm(`gagal: ${errText(e)}`),
        );
      }
    });
    warmUpOcr().catch((e: unknown) => setOcrError(`OCR gagal dimuat: ${errText(e)}`));
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
    if (!file) return;
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
      else setOcrError(`OCR gagal: ${errText(ocrRes.reason)} — penjelasan cloud dinonaktifkan.`);
      if (nanoRes.status === "fulfilled") {
        const merged = mergeMaskedPii(nanoRes.value, det);
        setResult(merged);
        setRows(merged.results);
        setMetrics((m) => ({ ...m, totalMs: since(), rows: merged.results.length }));
      } else {
        setError(errText(nanoRes.reason));
        if (streamed > 0) setPartial(`${errText(nanoRes.reason)} — ${streamed} baris parsial, belum tervalidasi, tidak dikirim ke cloud`);
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

  async function onExplain() {
    if (!result || !known || cloudLocked) return;
    let payload: CloudPayload;
    try {
      payload = buildCloudPayload(result.results, known);
    } catch (e) {
      setExplain(e instanceof PiiLeakError ? { status: "blocked", kinds: e.kinds } : { status: "unsent", message: errText(e) });
      return;
    }
    const sent = { rows: payload.sentRows, dropped: payload.droppedRows };
    setExplain({ status: "running", sent });
    try {
      setExplain({ status: "done", sent, text: await explainInCloud(payload, known) });
    } catch (e) {
      setExplain(e instanceof PiiLeakError ? { status: "blocked", kinds: e.kinds } : { status: "error", sent, message: errText(e) });
    }
  }

  const badge =
    explain.status === "blocked"
      ? { cls: "bg-red-600", text: "Diblokir — PII terdeteksi, tidak ada yang dikirim" }
      : explain.status === "error"
        ? { cls: "bg-amber-600", text: `Guard lulus (${explain.sent.rows} baris tanpa PII) — permintaan cloud gagal, tidak ada penjelasan` }
      : explain.status === "running" || explain.status === "done"
        ? {
            cls: "bg-green-700",
            text: `Guard lulus — ${explain.sent.rows} baris tanpa PII dikirim ke cloud${explain.sent.dropped ? ` (${explain.sent.dropped} dibuang allowlist)` : ""}`,
          }
        : cloudLocked && (ocr || ocrError)
          ? { cls: "bg-amber-600", text: "Cloud dinonaktifkan — tinjau manual" }
          : { cls: "bg-zinc-500", text: "Belum ada data dikirim ke cloud" };

  const fmtS = (ms?: number) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8 font-sans">
      <h1 className="text-2xl font-semibold">LabLens — spike on-device</h1>
      <p className="text-sm">
        Gemini Nano: <code className="font-mono">{availability}</code>
        {warm && (
          <>
            {" "}
            · model: <code className="font-mono">{warm}</code>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={!file || busy}
          onClick={onExtract}
        >
          {busy ? "Mengekstrak…" : "Ekstrak (on-device)"}
        </button>
        {busy && (
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => abortRef.current?.abort()}>
            Batal
          </button>
        )}
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={ocrContext} disabled={busy} onChange={(e) => setOcrContext(e.target.checked)} />
          beri teks OCR tersensor ke Nano (eksperimen)
        </label>
      </div>
      {busy && (
        <p className="text-sm" aria-live="polite">
          {ocr ? "OCR selesai · " : "OCR lokal… · "}
          {stage ? STAGE_LABEL[stage] : "memulai…"} {elapsedS} s / maks {EXTRACT_TIMEOUT_MS / 1000} s
        </p>
      )}
      <p className="font-mono text-xs" data-testid="metrics" data-metrics={JSON.stringify(metrics)}>
        OCR+sensor {fmtS(metrics.ocrMs)} · baris pertama {fmtS(metrics.firstRowMs)} · total {fmtS(metrics.totalMs)}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ocrError && <p className="text-sm text-red-600">{ocrError}</p>}

      <section className="rounded border p-3" data-testid="redacted-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Disensor lokal</h2>
          <span className={`rounded px-2 py-0.5 text-xs text-white ${badge.cls}`} data-testid="cloud-badge">
            {badge.text}
          </span>
        </div>
        {ocr?.reviewRequired && (
          <p className="mt-2 text-sm text-amber-700" role="alert">
            Batas tabel hasil tidak ditemukan, jadi kepala laporan (nama, NIK, dll.) tidak bisa dipastikan tersensor.
            Penjelasan cloud dinonaktifkan untuk dokumen ini — periksa gambar tersensor secara manual.
          </p>
        )}
        {!ocr && <p className="text-sm text-zinc-500">{busy ? "OCR + aturan PII berjalan di perangkat…" : "—"}</p>}
        {ocr && (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL lokal, bukan aset Next */}
            <img src={ocr.imageUrl} alt="Pratinjau gambar yang sudah disensor" className="w-full rounded border" />
            <div className="flex flex-col gap-2 text-xs">
              <p>
                OCR + sensor: {ocr.ms} ms · PII per jenis:{" "}
                {Object.entries(ocr.counts)
                  .map(([k, n]) => `${SPAN_KIND_LABEL[k as PiiSpanKind]} ${n}`)
                  .join(" · ") || "tidak ada"}
              </p>
              <pre className="max-h-72 overflow-auto rounded bg-zinc-100 p-2 text-black" data-testid="redacted-text">
                {ocr.text}
              </pre>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium">Hasil {busy && rows.length > 0 && "(streaming…)"}</h2>
        {partial && (
          <p className="text-sm text-amber-700" data-testid="partial">
            Parsial: {partial}
          </p>
        )}
        <table className={`w-full text-left text-xs ${partial ? "italic opacity-60" : ""}`} data-testid="rows">
          <thead>
            <tr>
              <th>Pemeriksaan</th>
              <th>Hasil</th>
              <th>Satuan</th>
              <th>Rujukan</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>—</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.testName}</td>
                <td>{r.value}</td>
                <td>{r.unit}</td>
                <td>{r.referenceRange}</td>
                <td>{r.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm disabled:opacity-40"
            disabled={!result || cloudLocked || busy || explain.status === "running"}
            onClick={onExplain}
          >
            Jelaskan (cloud)
          </button>
          <span className="text-xs text-zinc-500">
            Hanya baris dengan nama tes dikenal + nilai/satuan/rentang berpola yang dikirim; diperiksa ulang oleh guard PII.
          </span>
        </div>
        {explain.status === "blocked" && (
          <p className="text-sm text-red-600" role="alert">
            Diblokir sebelum dikirim: payload masih memuat data identitas ({explain.kinds.join(", ")}). Tidak ada data yang keluar.
          </p>
        )}
        {(explain.status === "error" || explain.status === "unsent") && <p className="text-sm text-red-600">{explain.message}</p>}
        {explain.status === "done" && <p className="whitespace-pre-wrap text-sm">{explain.text}</p>}
      </section>

      <section>
        <h2 className="font-medium">Hasil JSON</h2>
        <pre className="overflow-auto rounded bg-zinc-100 p-3 text-xs text-black" data-testid="result-json">
          {result ? JSON.stringify(result, null, 2) : "—"}
        </pre>
      </section>
      <section>
        <h2 className="font-medium">Routing transparency</h2>
        <ul className="font-mono text-xs">
          {events.length === 0 && <li>—</li>}
          {events.map((ev) => (
            <li key={ev.id}>
              {new Date(ev.at).toLocaleTimeString()} · {ev.step} · {ev.location} · {ev.latencyMs} ms
              {ev.stages &&
                ` (gambar ${ev.stages.prepMs ?? "–"} · sesi ${ev.stages.sessionMs ?? "–"} · baca ${ev.stages.prefillMs ?? "–"} · baris-1 ${ev.stages.firstRowMs ?? "–"} · tulis ${ev.stages.generateMs ?? "–"} ms)`}{" "}
              · {ev.ok ? "ok" : `gagal: ${ev.error}`}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
