import { useEffect, useState } from "react";
import type { LabFlag, LabTestResult } from "@/lib/ai/schemas";
import { FlagBadge } from "./FlagBadge";
import { RangeBar } from "./RangeBar";
import { rangeGeometry } from "./rangeScale";
import { DISPLAY_NUM, EYEBROW } from "./ui";

const ORDER: readonly LabFlag[] = ["normal", "low", "high", "critical", "unknown"];
const LABEL: Readonly<Record<LabFlag, string>> = { normal: "Normal", low: "Low", high: "High", critical: "Critical", unknown: "Unread" };
/** Warna segmen/legend — selalu disertai label teks. */
const STROKE: Readonly<Record<LabFlag, string>> = {
  normal: "stroke-ok",
  low: "stroke-low",
  high: "stroke-warn",
  critical: "stroke-danger",
  unknown: "stroke-line-strong",
};
const DOT: Readonly<Record<LabFlag, string>> = { normal: "bg-ok", low: "bg-low", high: "bg-warn", critical: "bg-danger", unknown: "bg-line-strong" };

/** Angka naik dari 0 ke target (rAF, ~700 ms); langsung final bila prefers-reduced-motion. */
function useCountUp(target: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let start = 0;
    const from = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = reduce ? 1 : Math.min(1, (t - start) / 700);
      setN(Math.round(from + (target - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

function Count({ value, className = "" }: { value: number; className?: string }) {
  const n = useCountUp(value);
  return (
    <>
      <span aria-hidden="true" className={className}>
        {n}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}

function Donut({ counts, total }: { counts: Readonly<Record<LabFlag, number>>; total: number }) {
  const GAP = total > 1 ? 1.2 : 0;
  const lens = ORDER.map((f) => (total ? (counts[f] / total) * 100 : 0));
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <svg viewBox="0 0 42 42" className="size-28 -rotate-90 motion-safe:animate-pop" aria-hidden="true">
      <circle cx="21" cy="21" r="15.9" fill="none" strokeWidth="4" className="stroke-line" />
      {ORDER.map((f, i) => {
        const len = lens[i];
        const offset = starts[i];
        if (!len) return null;
        return (
          <circle
            key={f}
            cx="21"
            cy="21"
            r="15.9"
            fill="none"
            strokeWidth="4"
            strokeLinecap="butt"
            pathLength={100}
            strokeDasharray={`${Math.max(0.5, len - GAP)} ${100 - Math.max(0.5, len - GAP)}`}
            strokeDashoffset={-offset}
            className={STROKE[f]}
          />
        );
      })}
    </svg>
  );
}

const pctText = (d: number) => `${Math.max(1, Math.round(d * 100))}%`;

/** Ringkasan kesehatan dari flag lokal: komposisi normal/low/high, total, dan tes paling jauh dari rentang. */
export function HealthSnapshot({ rows }: { rows: readonly LabTestResult[] }) {
  const counts = Object.fromEntries(ORDER.map((f) => [f, rows.filter((r) => r.flag === f).length])) as Record<LabFlag, number>;
  const total = rows.length;
  const outside = counts.low + counts.high + counts.critical;
  const worst = rows
    .map((r) => ({ r, g: r.flag === "normal" || r.flag === "unknown" ? null : rangeGeometry(r.value, r.referenceRange) }))
    .filter((x): x is { r: LabTestResult; g: NonNullable<ReturnType<typeof rangeGeometry>> } => !!x.g && x.g.deviation > 0)
    .sort((a, b) => (b.r.flag === "critical" ? 1 : 0) - (a.r.flag === "critical" ? 1 : 0) || b.g.deviation - a.g.deviation)[0];

  return (
    <section aria-labelledby="snapshot-heading" className="grid gap-4 rounded-card border border-line bg-surface-2/60 p-4 sm:grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_minmax(0,16rem)] md:items-center" data-testid="health-snapshot">
      <div className="relative mx-auto grid place-items-center sm:mx-0">
        <Donut counts={counts} total={total} />
        <div className="absolute inset-0 grid place-content-center text-center">
          <Count value={total} className={`${DISPLAY_NUM} block text-3xl leading-none`} />
          <span className="text-[11px] text-muted">tests</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h3 id="snapshot-heading" className={EYEBROW}>
            Health snapshot
          </h3>
          <p className="mt-1 text-lg leading-snug font-semibold tracking-tight">
            <Count value={outside} className={DISPLAY_NUM} /> of {total} outside the reference range
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Results by flag">
          {ORDER.filter((f) => counts[f] > 0).map((f) => (
            <li key={f} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2 rounded-full ${DOT[f]}`} />
              <span className="text-muted">{LABEL[f]}</span>
              <Count value={counts[f]} className={`${DISPLAY_NUM} text-ink`} />
            </li>
          ))}
        </ul>
      </div>

      {worst ? (
        <div className="flex flex-col gap-2 rounded-control border border-line bg-surface p-3 sm:col-span-2 md:col-span-1" data-testid="most-deviant">
          <p className={EYEBROW}>Furthest from range</p>
          <div className="flex items-start justify-between gap-2">
            <p className="leading-tight font-semibold">{worst.r.testName}</p>
            <FlagBadge flag={worst.r.flag} />
          </div>
          <p className="text-sm">
            <span className={`${DISPLAY_NUM} text-lg`}>{worst.r.value}</span> <span className="text-muted">{worst.r.unit}</span>
            <span className="block text-xs text-muted">
              {pctText(worst.g.deviation)} {worst.g.direction === "above" ? "above the upper" : "below the lower"} limit · ref{" "}
              <span className="font-mono">{worst.r.referenceRange}</span>
            </span>
          </p>
          <RangeBar value={worst.r.value} unit={worst.r.unit} range={worst.r.referenceRange} flag={worst.r.flag} />
        </div>
      ) : (
        <p className="rounded-control border border-ok/40 bg-ok-soft p-3 text-sm text-ok-ink sm:col-span-2 md:col-span-1">
          {total > 0 && outside === 0 ? "Every readable value is inside its reference range." : "No value outside its range yet."}
        </p>
      )}
    </section>
  );
}
