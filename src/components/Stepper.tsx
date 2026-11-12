import type { ReactNode } from "react";
import { AlertIcon, CheckIcon, CloudIcon, DeviceIcon } from "./icons";
import type { InferenceLocation } from "./LocationTag";

export type StepStatus = "todo" | "active" | "done" | "attention" | "error";

export interface StepItem {
  key: string;
  title: string;
  /** Di mana langkah ini berjalan. */
  where: InferenceLocation;
  detail: string;
  status: StepStatus;
}

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  todo: "Not started",
  active: "In progress",
  done: "Done",
  attention: "Needs your action",
  error: "Stopped",
};

function Marker({ index, status }: { index: number; status: StepStatus }): ReactNode {
  const base = "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold";
  if (status === "done") return <span className={`${base} border-ok bg-ok text-surface`}><CheckIcon size={14} /></span>;
  if (status === "error") return <span className={`${base} border-danger bg-danger-soft text-danger-ink`}><AlertIcon size={14} /></span>;
  if (status === "attention") return <span className={`${base} border-warn bg-warn-soft text-warn-ink`}>!</span>;
  if (status === "active")
    return (
      <span className={`${base} border-ink bg-ink text-surface`}>
        <span className="motion-safe:animate-pulse">{index + 1}</span>
      </span>
    );
  return <span className={`${base} border-line-strong bg-surface text-muted`}>{index + 1}</span>;
}

/** Progres alur: Upload → Read & mask → Extract → Explain, dengan lokasi tiap langkah. */
export function Stepper({ steps }: { steps: readonly StepItem[] }) {
  return (
    <nav aria-label="Progress">
      <ol className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4" data-testid="stepper">
        {steps.map((s, i) => {
          const Icon = s.where === "device" ? DeviceIcon : CloudIcon;
          return (
            <li
              key={s.key}
              aria-current={s.status === "active" ? "step" : undefined}
              data-status={s.status}
              className={`flex min-w-0 items-start gap-2.5 rounded-control border p-2.5 transition-colors ${
                s.status === "active" ? "border-ink/60 bg-surface" : s.status === "attention" ? "border-warn/60 bg-warn-soft" : "border-transparent"
              }`}
            >
              <Marker index={i} status={s.status} />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  {s.title}
                  <span className="sr-only"> — {STATUS_TEXT[s.status]}</span>
                </p>
                <p className={`mt-0.5 flex items-center gap-1 text-xs ${s.where === "device" ? "text-device-ink" : "text-cloud-ink"}`}>
                  <Icon size={13} className="shrink-0" />
                  <span className="leading-snug">{s.detail}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
