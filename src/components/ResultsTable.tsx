import type { LabTestResult } from "@/lib/ai/schemas";
import { FlagBadge } from "./FlagBadge";

const SKELETON_ROWS = 5;
const SKELETON_WIDTHS = ["w-4/5", "ml-auto w-1/3", "w-1/2", "w-2/3", "w-3/5"] as const;

/** Latar baris per flag (token; flag juga selalu punya ikon + teks lewat FlagBadge). */
const ROW_TINT: Readonly<Record<LabTestResult["flag"], string>> = {
  critical: "bg-danger-soft",
  high: "bg-warn-soft/60",
  low: "bg-low-soft/60",
  normal: "",
  unknown: "",
};

interface ResultsTableProps {
  rows: readonly LabTestResult[];
  /** Ekstraksi sedang berjalan (tampilkan skeleton / baris berikutnya). */
  loading: boolean;
  partial: boolean;
}

const TH = "px-3 py-2 text-left text-xs font-medium text-muted first:pl-4 last:pr-4";
const TD = "px-3 py-2.5 align-top first:pl-4 last:pr-4";

/**
 * Hasil + flag lokal. ≥sm: tabel; layar sempit: daftar kartu (tabel 5 kolom tidak muat di ~390px).
 * Skeleton saat menunggu baris; baris baru masuk halus (hormati reduced-motion).
 */
export function ResultsTable({ rows, loading, partial }: ResultsTableProps) {
  if (rows.length === 0 && !loading)
    return (
      <p className="rounded-control border border-dashed border-line-strong p-4 text-sm text-muted">
        No rows yet. Extracted tests appear here as they stream in, each with a flag computed on this device from its reference range.
      </p>
    );
  const skeletons = loading ? (rows.length === 0 ? SKELETON_ROWS : 1) : 0;
  return (
    <>
      <ul className={`flex flex-col divide-y divide-line rounded-control border border-line sm:hidden ${partial ? "italic opacity-60" : ""}`} aria-label="Extracted lab results">
        {rows.map((r, i) => (
          <li key={i} className={`flex items-start justify-between gap-3 px-3 py-2.5 motion-safe:animate-enter ${ROW_TINT[r.flag]}`}>
            <div className="min-w-0">
              <p className="font-medium leading-snug">{r.testName}</p>
              <p className="mt-0.5 text-sm">
                <span className="font-mono font-semibold tabular-nums">{r.value}</span> <span className="text-muted">{r.unit}</span>
              </p>
              {r.referenceRange && <p className="font-mono text-xs text-muted">Ref {r.referenceRange}</p>}
            </div>
            <FlagBadge flag={r.flag} />
          </li>
        ))}
        {Array.from({ length: skeletons }, (_, i) => (
          <li key={`sk-${i}`} aria-hidden="true" className="flex items-center justify-between gap-3 px-3 py-3">
            <span className="flex w-2/3 flex-col gap-1.5">
              <span className="h-3.5 w-3/4 rounded bg-line motion-safe:animate-pulse" />
              <span className="h-3 w-1/2 rounded bg-line motion-safe:animate-pulse" />
            </span>
            <span className="h-5 w-16 rounded-full bg-line motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-control border border-line sm:block">
        <table className={`w-full min-w-[34rem] text-sm ${partial ? "italic opacity-60" : ""}`} data-testid="rows">
          <caption className="sr-only">Extracted lab results with locally computed flags</caption>
          <thead className="bg-surface-2">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Test</th>
              <th scope="col" className={`${TH} text-right`}>Result</th>
              <th scope="col" className={TH}>Unit</th>
              <th scope="col" className={TH}>Reference</th>
              <th scope="col" className={TH}>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-line last:border-0 motion-safe:animate-enter ${ROW_TINT[r.flag]}`}>
                <td className={`${TD} font-medium`}>{r.testName}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{r.value}</td>
                <td className={`${TD} text-muted`}>{r.unit}</td>
                <td className={`${TD} font-mono text-xs tabular-nums text-muted`}>{r.referenceRange}</td>
                <td className={TD}>
                  <FlagBadge flag={r.flag} />
                </td>
              </tr>
            ))}
            {Array.from({ length: skeletons }, (_, i) => (
              <tr key={`sk-${i}`} aria-hidden="true" className="border-b border-line last:border-0">
                {SKELETON_WIDTHS.map((w, j) => (
                  <td key={j} className={TD}>
                    <span className={`block h-3.5 rounded bg-line motion-safe:animate-pulse ${w}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
