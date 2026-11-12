import type { LabFlag } from "@/lib/ai/schemas";

/** Flag tidak hanya warna: selalu ikon + teks (PRD: "warna flag tidak bergantung hanya pada warna"). */
const FLAG_STYLE: Readonly<Record<LabFlag, { label: string; icon: string; cls: string }>> = {
  low: { label: "Low", icon: "↓", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100" },
  normal: {
    label: "Normal",
    icon: "✓",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  },
  high: { label: "High", icon: "↑", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" },
  critical: { label: "Critical", icon: "!", cls: "border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100" },
  unknown: { label: "Unknown", icon: "?", cls: "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" },
};

export function FlagBadge({ flag }: { flag: LabFlag }) {
  const s = FLAG_STYLE[flag];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span aria-hidden="true" className="font-mono">
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}
