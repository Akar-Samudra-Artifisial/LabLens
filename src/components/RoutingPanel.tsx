import { useId, useState } from "react";
import type { RoutingEvent, RoutingStatus } from "@/lib/ai/router";
import type { LabTestResult } from "@/lib/ai/schemas";
import { type FallbackPreview, fmtBytes, PayloadInspector, type PayloadPreview } from "./PayloadInspector";
import { useOnlineStatus } from "./useOnlineStatus";

function LaptopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" strokeLinecap="round" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS: Readonly<Record<RoutingStatus, { label: string; cls: string }>> = {
  ok: { label: "OK", cls: "text-emerald-800 dark:text-emerald-300" },
  error: { label: "Failed", cls: "text-red-700 dark:text-red-400" },
  blocked: { label: "Blocked before sending", cls: "text-red-700 dark:text-red-400" },
};

const STEP_LABEL: Readonly<Record<RoutingEvent["step"], string>> = { extract: "Read report", explain: "Explain results" };

const onDevice = (ev: RoutingEvent) => ev.location === "on_device";

function stagesText(ev: RoutingEvent): string | null {
  const s = ev.stages;
  if (!s) return null;
  const part = (label: string, ms?: number) => (ms === undefined ? null : `${label} ${ms} ms`);
  return [part("image", s.prepMs), part("session", s.sessionMs), part("read", s.prefillMs), part("first row", s.firstRowMs), part("write", s.generateMs)]
    .filter(Boolean)
    .join(" · ");
}

function OnlineIndicator() {
  const online = useOnlineStatus();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" role="status" data-testid="online-status">
      <span aria-hidden="true" className={`size-2 rounded-full ${online ? "bg-emerald-600" : "bg-zinc-400"}`} />
      {online ? "Online" : "Offline — cloud steps unavailable"}
    </span>
  );
}

function Stat({ value, label, testId }: { value: string; label: string; testId?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="font-mono text-lg font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

interface RoutingPanelProps {
  events: readonly RoutingEvent[];
  /** Span PII yang terdeteksi aturan lokal pada dokumen aktif; null = belum ada OCR. */
  piiDetectedLocal: number | null;
  preview: PayloadPreview;
  rows: readonly LabTestResult[];
  /** Pratinjau fallback ekstraksi cloud bila sedang ditawarkan. */
  fallback?: FallbackPreview | null;
}

/**
 * US-6/US-10: timeline on-device vs cloud, ringkasan guard PII, inspector payload, status online.
 * Framing jujur: guard memblokir payload ber-PII sebelum request, jadi "PII in cloud payloads" adalah hasil re-check guard
 * atas teks yang dikirim (bukan pengukuran independen); jumlah payload yang DIBLOKIR ditampilkan terpisah.
 */
export function RoutingPanel({ events, piiDetectedLocal, preview, rows, fallback }: RoutingPanelProps) {
  const [inspecting, setInspecting] = useState(false);
  const inspectorId = useId();
  const sentEvents = events.filter((e) => e.bytesSent > 0);
  const bytesSent = sentEvents.reduce((n, e) => n + e.bytesSent, 0);
  const piiInPayloads = sentEvents.reduce((n, e) => n + e.piiSent, 0);
  const blocked = events.filter((e) => e.status === "blocked").length;
  const lastSent = [...events].reverse().find((e) => e.payload)?.payload ?? null;
  const last = events.at(-1);

  return (
    <section aria-labelledby="routing-heading" className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-testid="routing-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="routing-heading" className="font-semibold">
          Routing transparency
        </h2>
        <OnlineIndicator />
      </div>

      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-2">
          <Stat value={piiDetectedLocal === null ? "–" : String(piiDetectedLocal)} label="PII found on device" testId="pii-local" />
          <Stat value={String(piiInPayloads)} label="PII in cloud payloads" testId="pii-in-payloads" />
          <Stat
            value={fmtBytes(bytesSent)}
            label={`Sent to cloud (${sentEvents.length} request${sentEvents.length === 1 ? "" : "s"})`}
            testId="bytes-sent"
          />
          <Stat value={String(blocked)} label="Payloads blocked by guard" testId="payloads-blocked" />
        </dl>
        <p className="text-xs text-zinc-700 dark:text-zinc-300" data-testid="guard-summary">
          {sentEvents.length === 0
            ? "Nothing has been sent to the cloud yet. Identity data found on this device stays here."
            : `Every cloud payload (${fmtBytes(bytesSent)} in total) passed the PII guard before sending; the same guard re-checked the exact text that was sent.`}
          {blocked > 0 && ` ${blocked} payload${blocked === 1 ? " was" : "s were"} blocked and never sent.`}
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {last ? `${STEP_LABEL[last.step]} ${onDevice(last) ? "on device" : "in the cloud"}: ${STATUS[last.status].label}, ${last.latencyMs} ms` : ""}
      </p>

      <div>
        <h3 className="text-sm font-medium">Timeline</h3>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No steps yet. Reading the report runs on this device.</p>
        ) : (
          <ol className="mt-2 flex flex-col" data-testid="routing-timeline">
            {events.map((ev, i) => {
              const local = onDevice(ev);
              const stages = stagesText(ev);
              return (
                <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0" data-step={ev.step} data-location={ev.location} data-status={ev.status}>
                  {i < events.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-zinc-200 dark:bg-zinc-800" />}
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${
                      local ? "border-emerald-400 text-emerald-800 dark:text-emerald-300" : "border-sky-400 text-sky-800 dark:text-sky-300"
                    }`}
                  >
                    {local ? <LaptopIcon /> : <CloudIcon />}
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {STEP_LABEL[ev.step]} · {local ? "On-device (Gemini Nano)" : ev.location === "in_cloud" ? "Cloud (Gemini)" : "Unknown"}
                    </p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">
                      <span className={`font-medium ${STATUS[ev.status].cls}`}>{STATUS[ev.status].label}</span> · {ev.latencyMs.toLocaleString("en-US")} ms ·{" "}
                      {ev.bytesSent > 0 ? `${fmtBytes(ev.bytesSent)} sent, ${ev.piiSent} PII` : "0 B left the device"} ·{" "}
                      <time dateTime={new Date(ev.at).toISOString()}>{new Date(ev.at).toLocaleTimeString("en-US")}</time>
                    </p>
                    {stages && <p className="mt-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">{stages}</p>}
                    {ev.error && <p className="mt-0.5 break-words text-xs text-red-700 dark:text-red-400">{ev.error}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={inspecting}
          aria-controls={inspectorId}
          onClick={() => setInspecting((v) => !v)}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100"
        >
          {inspecting ? "Hide cloud payload" : "Inspect cloud payload"}
        </button>
        <div id={inspectorId} hidden={!inspecting} className="mt-3">
          {inspecting && <PayloadInspector preview={preview} sent={lastSent} rows={rows} fallback={fallback} />}
        </div>
      </div>
    </section>
  );
}
