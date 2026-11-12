import type { CSSProperties } from "react";
import type { LabFlag } from "@/lib/ai/schemas";
import { RANGE_SCALE_NOTE, rangeGeometry, rangeSummary } from "./rangeScale";

const MARKER: Readonly<Record<LabFlag, string>> = {
  low: "bg-low shadow-[0_0_0_3px_var(--low-soft)]",
  high: "bg-warn shadow-[0_0_0_3px_var(--warn-soft)]",
  critical: "bg-danger shadow-[0_0_0_3px_var(--danger-soft)]",
  normal: "bg-ok shadow-[0_0_0_3px_var(--ok-soft)]",
  unknown: "bg-muted",
};
const ARROW: Readonly<Record<LabFlag, string>> = { low: "text-low", high: "text-warn", critical: "text-danger", normal: "text-ok", unknown: "text-muted" };

interface RangeBarProps {
  value: string;
  unit?: string;
  range: string;
  flag: LabFlag;
  className?: string;
}

/** Panah di tepi trek: nilai berada di luar skala yang digambar. */
function EdgeArrow({ side, flag }: { side: "low" | "high"; flag: LabFlag }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden="true"
      className={`absolute top-1/2 h-2.5 w-2 -translate-y-1/2 fill-current ${ARROW[flag]} ${side === "high" ? "-right-2.5" : "-left-2.5 rotate-180"}`}
    >
      <path d="M0 0 8 5 0 10Z" />
    </svg>
  );
}

/**
 * Posisi nilai terhadap rentang rujukan (skala ilustratif): trek, zona normal, penanda berwarna flag.
 * Visual aria-hidden; pembaca layar mendapat ringkasan teks (sr-only). Arah selalu = flag lokal.
 */
export function RangeBar({ value, unit = "", range, flag, className = "" }: RangeBarProps) {
  const g = rangeGeometry(value, range);
  if (!g) return null;
  const vars = { "--lo": `${g.normal[0]}%`, "--hi": `${100 - g.normal[1]}%`, "--v": `${g.value}%` } as CSSProperties;
  return (
    <span className={`relative block ${className}`} title={RANGE_SCALE_NOTE}>
      <span className="sr-only">{rangeSummary(value, unit, range, g)}</span>
      <span aria-hidden="true" className="relative mx-2.5 block h-3 min-w-24" style={vars}>
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <span className="absolute top-1/2 right-(--hi) left-(--lo) h-1 -translate-y-1/2 rounded-full bg-ok/45" />
        <span className="absolute top-1/2 left-(--lo) h-2.5 w-px -translate-y-1/2 bg-ok/70" />
        <span className="absolute top-1/2 right-(--hi) h-2.5 w-px -translate-y-1/2 bg-ok/70" />
        {g.clipped && <EdgeArrow side={g.clipped} flag={flag} />}
        <span className="absolute inset-0 motion-safe:animate-enter">
          <span className={`absolute top-1/2 left-(--v) size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${MARKER[flag]}`} />
        </span>
      </span>
    </span>
  );
}

/** Keterangan skala, sekali per tabel/daftar. */
export function RangeScaleNote({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-xs text-muted ${className}`}>
      <span aria-hidden="true" className="relative inline-block h-1 w-8 rounded-full bg-line">
        <span className="absolute inset-y-0 right-2 left-2 rounded-full bg-ok/60" />
      </span>
      {RANGE_SCALE_NOTE}
    </p>
  );
}
