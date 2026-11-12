import type { ComponentType } from "react";
import { AlertIcon, ChatIcon, CheckIcon, CloudIcon, DeviceIcon, LockIcon, ScanIcon, SparkIcon, UploadIcon } from "./icons";
import type { InferenceLocation } from "./LocationTag";
import { fmtBytes } from "./PayloadInspector";
import { EYEBROW } from "./ui";

export type StepStatus = "todo" | "ready" | "active" | "done" | "attention" | "blocked" | "error";

export interface StepItem {
  key: "upload" | "read" | "extract" | "explain";
  title: string;
  /** Di mana langkah ini berjalan. */
  where: InferenceLocation;
  detail: string;
  status: StepStatus;
}

/** Apa yang sudah menyeberangi batas privasi (dari event routing). */
export interface Crossing {
  bytes: number;
  pii: number;
  blocked: number;
}

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  todo: "Waiting",
  ready: "Ready",
  active: "Running",
  done: "Done",
  attention: "Needs you",
  blocked: "Blocked",
  error: "Stopped",
};

const ICON: Readonly<Record<StepItem["key"], ComponentType<{ size?: number }>>> = {
  upload: UploadIcon,
  read: ScanIcon,
  extract: SparkIcon,
  explain: ChatIcon,
};

function nodeClass(s: StepItem): string {
  const device = s.where === "device";
  switch (s.status) {
    case "active":
      return device ? "btn-device border-transparent shadow-glow-device" : "btn-cloud border-transparent shadow-glow-cloud";
    case "done":
      return device ? "border-device/50 bg-device-soft text-device-ink" : "border-cloud/50 bg-cloud-soft text-cloud-ink";
    case "ready":
      // Menunggu input: garis tepi warna lokasi, tanpa glow/animasi (tidak ada yang berjalan).
      return device ? "border-device/60 border-dashed bg-surface text-device-ink" : "border-cloud/60 border-dashed bg-surface text-cloud-ink";
    case "attention":
      return "border-warn/60 bg-warn-soft text-warn-ink";
    case "blocked":
      return "border-danger/60 bg-danger-soft text-danger-ink";
    case "error":
      return "border-danger/60 bg-danger-soft text-danger-ink";
    default:
      return "border-line-strong bg-surface-2 text-muted";
  }
}

const STATUS_TONE: Readonly<Record<StepStatus, string>> = {
  todo: "text-muted",
  ready: "text-ink",
  active: "text-ink",
  done: "text-ok-ink",
  attention: "text-warn-ink",
  blocked: "text-danger-ink",
  error: "text-danger-ink",
};

/** Partikel data: pembungkus selebar/setinggi trek digeser dengan transform; titik di ujungnya. */
function Particles({ tone }: { tone: InferenceLocation }) {
  const dot = tone === "device" ? "bg-device shadow-glow-device" : "bg-cloud shadow-glow-cloud";
  return (
    <>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`motion-decor absolute inset-0 animate-flow-y md:animate-flow-x ${["", "[animation-delay:-0.47s]", "[animation-delay:-0.94s]"][i]}`}
        >
          <span className={`absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full md:top-1/2 md:right-0 md:bottom-auto md:left-auto md:translate-x-0 md:-translate-y-1/2 ${dot}`} />
        </span>
      ))}
    </>
  );
}

function Connector({ from, to, next, boundary, crossing }: { from: StepItem; to: StepItem; next: StepStatus; boundary: boolean; crossing: Crossing }) {
  const flowing = next === "active";
  const lit = next === "done" || next === "attention";
  const grad =
    from.where === to.where
      ? from.where === "device"
        ? "from-device to-device-2"
        : "from-cloud to-cloud-2"
      : from.where === "device"
        ? "from-device to-cloud"
        : "from-cloud to-device";
  const crossed = crossing.bytes > 0;
  return (
    <div
      aria-hidden="true"
      className="absolute top-[3.5rem] bottom-1 left-6 w-2.5 -translate-x-1/2 md:top-6 md:right-[calc(-50%+2.25rem)] md:bottom-auto md:left-[calc(50%+2.25rem)] md:h-2.5 md:w-auto md:translate-x-0 md:-translate-y-1/2"
    >
      <div className="absolute inset-0 overflow-hidden">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong md:inset-x-0 md:inset-y-auto md:top-1/2 md:left-0 md:h-px md:w-auto md:translate-x-0 md:-translate-y-1/2" />
        <span
          className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-linear-to-b md:inset-x-0 md:inset-y-auto md:top-1/2 md:left-0 md:h-0.5 md:w-auto md:translate-x-0 md:-translate-y-1/2 md:bg-linear-to-r ${grad} transition-opacity duration-500 ${
            lit ? "opacity-100" : flowing ? "opacity-40" : "opacity-0"
          }`}
        />
        {flowing && <Particles tone={to.where} />}
      </div>
      {boundary && (
        <>
          <span className="absolute top-1/2 left-1/2 hidden h-10 w-px -translate-x-1/2 -translate-y-1/2 border-l border-dashed border-cloud/60 md:block" />
          <span
            className={`absolute top-1/2 left-5 -translate-y-1/2 rounded-full border px-2 py-0.5 font-mono text-[11px] whitespace-nowrap backdrop-blur md:top-5 md:left-1/2 md:-translate-x-1/2 md:translate-y-0 ${
              crossing.blocked > 0 && !crossed
                ? "border-danger/50 bg-danger-soft text-danger-ink"
                : crossed
                  ? "border-cloud/40 bg-cloud-soft text-cloud-ink"
                  : "border-line-strong bg-surface/80 text-muted"
            }`}
          >
            {crossing.blocked > 0 && !crossed ? "blocked · 0 B" : crossed ? `${fmtBytes(crossing.bytes)} · ${crossing.pii} PII` : "0 B crossed"}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Visual alur hybrid: Upload → Read & mask → Extract → Explain, dengan batas privasi device ↔ cloud.
 * Node menyala sesuai status; partikel mengalir pada konektor menuju langkah yang sedang berjalan;
 * label di batas menampilkan byte yang menyeberang ke cloud dan jumlah PII di dalamnya.
 */
export function Pipeline({ steps, crossing }: { steps: readonly StepItem[]; crossing: Crossing }) {
  const boundaryAt = steps.findIndex((s, i) => i < steps.length - 1 && steps[i + 1].where !== s.where);
  const crossed = crossing.bytes > 0;
  return (
    <nav aria-label="Progress" className="surface-glass rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`${EYEBROW} flex items-center gap-1.5`}>
          <span className="text-device-ink">
            <DeviceIcon size={14} />
          </span>
          On this device
        </span>
        <p className="order-last basis-full font-mono text-[11px] text-muted sm:order-none sm:basis-auto" data-testid="boundary-summary">
          <span aria-hidden="true">
            <LockIcon size={12} className="mr-1 inline align-[-2px]" />
            privacy boundary ·{" "}
            {crossed ? (
              <>
                <span className="text-cloud-ink">{fmtBytes(crossing.bytes)} crossed</span> · <span className="text-ok-ink">{crossing.pii} PII</span>
              </>
            ) : (
              "nothing crossed yet"
            )}
            {crossing.blocked > 0 && <span className="text-danger-ink"> · {crossing.blocked} blocked</span>}
          </span>
          <span className="sr-only">
            Privacy boundary between this device and the cloud:{" "}
            {crossed ? `${fmtBytes(crossing.bytes)} sent to the cloud, containing ${crossing.pii} personal identifiers.` : "nothing has been sent to the cloud yet."}
            {crossing.blocked > 0 && ` ${crossing.blocked} payload${crossing.blocked === 1 ? " was" : "s were"} blocked before sending.`}
          </span>
        </p>
        <span className={`${EYEBROW} flex items-center gap-1.5`}>
          Cloud
          <span className="text-cloud-ink">
            <CloudIcon size={14} />
          </span>
        </span>
      </div>
      <ol className="flex flex-col md:flex-row" data-testid="stepper" data-crossed-bytes={crossing.bytes}>
        {steps.map((s, i) => {
          const Icon = ICON[s.key];
          const next = steps[i + 1];
          return (
            <li
              key={s.key}
              aria-current={s.status === "active" || s.status === "ready" ? "step" : undefined}
              data-status={s.status}
              data-where={s.where}
              className={`relative flex min-w-0 items-start gap-3 md:flex-1 md:basis-0 md:flex-col md:items-center md:gap-2.5 md:text-center ${
                i === boundaryAt ? "pb-12 md:pb-0" : "pb-7 md:pb-0"
              } last:pb-0`}
            >
              {next && <Connector from={s} to={next} next={next.status} boundary={i === boundaryAt} crossing={crossing} />}
              <span className={`relative grid size-12 shrink-0 place-items-center rounded-2xl border transition-[background-color,box-shadow] duration-500 ${nodeClass(s)}`}>
                {s.status === "active" && (
                  <span
                    aria-hidden="true"
                    className={`motion-decor absolute -inset-1.5 rounded-[1.25rem] border-2 animate-breathe ${s.where === "device" ? "border-device" : "border-cloud"}`}
                  />
                )}
                {s.status === "error" ? <AlertIcon size={20} /> : s.status === "blocked" ? <LockIcon size={20} /> : <Icon size={20} />}
                {s.status === "done" && (
                  <span className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border-2 border-surface bg-ok text-surface motion-safe:animate-pop">
                    <CheckIcon size={11} strokeWidth={3} />
                  </span>
                )}
              </span>
              <div className="min-w-0 pt-0.5 md:pt-0">
                <p className="text-sm leading-tight font-semibold">
                  {s.title}
                  <span className="sr-only"> — {STATUS_TEXT[s.status]}</span>
                </p>
                <p className={`mt-1 text-xs leading-snug ${s.where === "device" ? "text-device-ink" : "text-cloud-ink"}`}>{s.detail}</p>
                <p aria-hidden="true" className={`mt-1 font-mono text-[11px] tracking-wide uppercase ${STATUS_TONE[s.status]}`}>
                  {STATUS_TEXT[s.status]}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
