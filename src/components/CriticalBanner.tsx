import { criticalRows } from "../lib/ai/explanation";
import type { LabTestResult } from "../lib/ai/schemas";
import { AlertIcon } from "./icons";

/**
 * Banner tenaga medis dari flag LOKAL — tampil begitu ekstraksi selesai, apa pun status cloud (terkunci/offline/gagal).
 * Path relatif agar bisa dirender di test node.
 */
export function CriticalBanner({ rows }: { rows: readonly LabTestResult[] }) {
  const critical = criticalRows(rows);
  if (critical.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-control border-2 border-danger bg-danger-soft px-4 py-3 text-danger-ink"
      data-testid="critical-banner"
    >
      <span className="mt-0.5 shrink-0 text-danger">
        <AlertIcon size={20} />
      </span>
      <div>
        <p className="font-semibold">
          {critical.length === 1 ? "1 value is" : `${critical.length} values are`} flagged critical: {critical.map((r) => r.testName).join(", ")}.
        </p>
        <p className="mt-1 text-sm">
          Contact a doctor or health facility today. If you feel unwell, seek emergency care. Do not wait for this app.
        </p>
      </div>
    </div>
  );
}
