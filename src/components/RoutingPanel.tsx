import { useId, useState } from "react";
import type { RoutingEvent, RoutingStatus } from "@/lib/ai/router";
import type { LabTestResult } from "@/lib/ai/schemas";
import { EyeIcon, ShieldIcon } from "./icons";
import { LocationDot, LocationTag } from "./LocationTag";
import { type FallbackPreview, fmtBytes, PayloadInspector, type PayloadPreview } from "./PayloadInspector";
import { BTN_SECONDARY, CARD, H2 } from "./ui";

const STATUS: Readonly<Record<RoutingStatus, { label: string; cls: string }>> = {
  ok: { label: "OK", cls: "border-ok/40 bg-ok-soft text-ok-ink" },
  error: { label: "Failed", cls: "border-danger/50 bg-danger-soft text-danger-ink" },
  blocked: { label: "Blocked before sending", cls: "border-danger/50 bg-danger-soft text-danger-ink" },
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

type Tone = "neutral" | "device" | "good" | "bad";

const TONE: Readonly<Record<Tone, string>> = {
  neutral: "border-line bg-surface",
  device: "border-device/40 bg-device-soft",
  good: "border-ok/40 bg-ok-soft",
  bad: "border-danger/50 bg-danger-soft",
};

function Stat({ value, label, testId, tone = "neutral" }: { value: string; label: string; testId?: string; tone?: Tone }) {
  return (
    <div className={`rounded-control border px-3 py-2.5 ${TONE[tone]}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Angka ringkas dari event routing (dipakai panel lengkap & strip ringkas mobile). */
export function routingTotals(events: readonly RoutingEvent[]) {
  const sentEvents = events.filter((e) => e.bytesSent > 0);
  return {
    sentEvents,
    bytesSent: sentEvents.reduce((n, e) => n + e.bytesSent, 0),
    piiInPayloads: sentEvents.reduce((n, e) => n + e.piiSent, 0),
    blocked: events.filter((e) => e.status === "blocked").length,
    deviceSteps: events.filter(onDevice).length,
    cloudSteps: events.filter((e) => e.location === "in_cloud").length,
  };
}

/**
 * Strip ringkas untuk layar sempit: panel lengkap jatuh di bawah konten di mobile, jadi angka privasi utama
 * ditampilkan lebih awal. Tanpa data-testid statistik agar tidak bentrok dengan panel lengkap.
 */
export const ROUTING_PANEL_ID = "routing-transparency";

export function RoutingSummary({ events, piiDetectedLocal }: { events: readonly RoutingEvent[]; piiDetectedLocal: number | null }) {
  const panelId = ROUTING_PANEL_ID;
  const t = routingTotals(events);
  const items: readonly [string, string, Tone][] = [
    ["PII found on device", piiDetectedLocal === null ? "–" : String(piiDetectedLocal), piiDetectedLocal ? "device" : "neutral"],
    ["PII in cloud payloads", String(t.piiInPayloads), t.piiInPayloads > 0 ? "bad" : "good"],
    ["Sent to cloud", fmtBytes(t.bytesSent), "neutral"],
  ];
  return (
    <section aria-labelledby="routing-summary-heading" className={`${CARD} flex flex-col gap-3 p-4`} data-testid="routing-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="routing-summary-heading" className={`${H2} flex items-center gap-2`}>
          <span className="text-device-ink">
            <ShieldIcon size={18} />
          </span>
          Privacy at a glance
        </h2>
        <a href={`#${panelId}`} className="rounded text-xs font-medium text-cloud-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Full timeline
        </a>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {items.map(([label, value, tone]) => (
          <div key={label} className={`rounded-control border px-2.5 py-2 ${TONE[tone]}`}>
            <dt className="text-[11px] leading-tight text-muted">{label}</dt>
            <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <LocationTag where="device" label={`On-device steps: ${t.deviceSteps}`} />
        <LocationTag where="cloud" label={`Cloud steps: ${t.cloudSteps}`} />
      </div>
    </section>
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
 * US-6/US-10: timeline on-device vs cloud, ringkasan guard PII, inspector payload.
 * Framing jujur: guard memblokir payload ber-PII sebelum request, jadi "PII in cloud payloads" adalah hasil re-check guard
 * atas teks yang dikirim (bukan pengukuran independen); jumlah payload yang DIBLOKIR ditampilkan terpisah.
 */
export function RoutingPanel({ events, piiDetectedLocal, preview, rows, fallback }: RoutingPanelProps) {
  const [inspecting, setInspecting] = useState(false);
  const inspectorId = useId();
  const { sentEvents, bytesSent, piiInPayloads, blocked } = routingTotals(events);
  const lastSent = [...events].reverse().find((e) => e.payload)?.payload ?? null;
  const last = events.at(-1);

  return (
    <section id={ROUTING_PANEL_ID} aria-labelledby="routing-heading" className={`${CARD} flex scroll-mt-4 flex-col gap-5 p-4 sm:p-5`} data-testid="routing-panel">
      <div className="flex flex-col gap-2">
        <h2 id="routing-heading" className={`${H2} flex items-center gap-2`}>
          <span className="text-device-ink">
            <ShieldIcon size={18} />
          </span>
          Routing transparency
        </h2>
        <p className="text-xs text-muted">Where each AI step ran, and exactly what left this device.</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="sr-only">Legend:</span>
          <LocationTag where="device" label="On-device · OCR, masking, Gemini Nano" />
          <LocationTag where="cloud" label="Cloud · Gemini via Firebase AI Logic" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-2">
          <Stat
            value={piiDetectedLocal === null ? "–" : String(piiDetectedLocal)}
            label="PII found on device"
            testId="pii-local"
            tone={piiDetectedLocal ? "device" : "neutral"}
          />
          <Stat value={String(piiInPayloads)} label="PII in cloud payloads" testId="pii-in-payloads" tone={piiInPayloads > 0 ? "bad" : "good"} />
          <Stat
            value={fmtBytes(bytesSent)}
            label={`Sent to cloud (${sentEvents.length} request${sentEvents.length === 1 ? "" : "s"})`}
            testId="bytes-sent"
          />
          <Stat value={String(blocked)} label="Payloads blocked by guard" testId="payloads-blocked" tone={blocked > 0 ? "bad" : "neutral"} />
        </dl>
        <p className="text-xs leading-relaxed text-muted" data-testid="guard-summary">
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
        <h3 className="text-sm font-semibold">Timeline</h3>
        {events.length === 0 ? (
          <p className="mt-2 rounded-control border border-dashed border-line-strong p-3 text-sm text-muted">
            No steps yet. Reading the report runs on this device; each step will appear here with its latency and bytes sent.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col" data-testid="routing-timeline">
            {events.map((ev, i) => {
              const local = onDevice(ev);
              const stages = stagesText(ev);
              return (
                <li
                  key={ev.id}
                  className="relative flex gap-3 pb-4 last:pb-0 motion-safe:animate-enter"
                  data-step={ev.step}
                  data-location={ev.location}
                  data-status={ev.status}
                >
                  {i < events.length - 1 && <span aria-hidden="true" className="absolute top-9 bottom-1 left-[15px] w-px bg-line-strong" />}
                  <LocationDot where={local ? "device" : "cloud"} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                      {STEP_LABEL[ev.step]}
                      <span className={`text-xs ${local ? "text-device-ink" : "text-cloud-ink"}`}>
                        {local ? "On-device (Gemini Nano)" : ev.location === "in_cloud" ? "Cloud (Gemini)" : "Unknown"}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className={`rounded-full border px-1.5 py-px font-medium ${STATUS[ev.status].cls}`}>{STATUS[ev.status].label}</span>
                      <span className="font-mono tabular-nums">{ev.latencyMs.toLocaleString("en-US")} ms</span>
                      <span>{ev.bytesSent > 0 ? `${fmtBytes(ev.bytesSent)} sent, ${ev.piiSent} PII` : "0 B left the device"}</span>
                      <time dateTime={new Date(ev.at).toISOString()}>{new Date(ev.at).toLocaleTimeString("en-US")}</time>
                    </p>
                    {stages && <p className="mt-1 font-mono text-[11px] text-muted">{stages}</p>}
                    {ev.error && <p className="mt-1 break-words text-xs text-danger-ink">{ev.error}</p>}
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
          className={`${BTN_SECONDARY} w-full`}
        >
          <EyeIcon size={16} />
          {inspecting ? "Hide cloud payload" : "Inspect cloud payload"}
        </button>
        <div id={inspectorId} hidden={!inspecting} className="mt-4">
          {inspecting && <PayloadInspector preview={preview} sent={lastSent} rows={rows} fallback={fallback} />}
        </div>
      </div>
    </section>
  );
}
