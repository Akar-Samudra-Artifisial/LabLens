import type { ComponentType } from "react";
import type { LabFlag } from "@/lib/ai/schemas";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, QuestionIcon } from "./icons";

/** Flag tidak hanya warna: selalu ikon + teks (PRD: "warna flag tidak bergantung hanya pada warna"). */
const FLAG_STYLE: Readonly<Record<LabFlag, { label: string; Icon: ComponentType<{ size?: number }>; cls: string }>> = {
  low: { label: "Low", Icon: ArrowDownIcon, cls: "border-low/50 bg-low-soft text-low-ink" },
  normal: { label: "Normal", Icon: CheckIcon, cls: "border-ok/40 bg-ok-soft text-ok-ink" },
  high: { label: "High", Icon: ArrowUpIcon, cls: "border-warn/50 bg-warn-soft text-warn-ink" },
  critical: { label: "Critical", Icon: AlertIcon, cls: "border-danger bg-danger text-surface" },
  unknown: { label: "Unknown", Icon: QuestionIcon, cls: "border-line-strong bg-surface-2 text-muted" },
};

export function FlagBadge({ flag }: { flag: LabFlag }) {
  const s = FLAG_STYLE[flag];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <s.Icon size={12} />
      {s.label}
    </span>
  );
}
