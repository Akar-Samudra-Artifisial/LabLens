import type { LabTestResult } from "@/lib/ai/schemas";
import { CriticalBanner } from "../CriticalBanner";
import { AlertIcon } from "../icons";
import { type InferenceLocation, LocationTag } from "../LocationTag";
import { MedicalDisclaimer } from "../MedicalDisclaimer";
import { ResultsTable } from "../ResultsTable";
import { HealthSnapshot } from "../HealthSnapshot";
import { CALLOUT, CARD, CARD_BODY, DISPLAY_NUM, EYEBROW, H2, MUTED } from "../ui";
import type { Metrics } from "./types";

const fmtS = (ms?: number) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);

interface ResultsCardProps {
  rows: readonly LabTestResult[];
  metrics: Metrics;
  partial: string | null;
  where: InferenceLocation;
  busy: boolean;
  /** Ekstraksi (Nano/cloud) sedang menghasilkan baris. */
  extracting: boolean;
  /** Langkah Extract berstatus error (gagal/dibatalkan) — label lokasi tidak boleh mengklaim "Extracted". */
  failed?: boolean;
}

/** Tabel hasil + flag lokal, ringkasan waktu, banner critical, disclaimer. */
export function ResultsCard({ rows, metrics, partial, where, busy, extracting, failed = false }: ResultsCardProps) {
  const stats = [
    ["Rows", metrics.rows !== undefined ? String(metrics.rows) : rows.length > 0 ? String(rows.length) : "–"],
    ["OCR + mask", fmtS(metrics.ocrMs)],
    ["First row", fmtS(metrics.firstRowMs)],
    ["Total", fmtS(metrics.totalMs)],
  ] as const;
  return (
    <section aria-labelledby="results-heading" className={CARD}>
      <div className={CARD_BODY}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="results-heading" className={H2}>
            Results {busy && rows.length > 0 && <span className={`text-sm font-normal ${MUTED}`}>(streaming…)</span>}
          </h2>
          <LocationTag
            where={where}
            label={
              where === "cloud"
                ? failed
                  ? "Private cloud extraction failed"
                  : "Extracted in private cloud"
                : failed
                  ? "On-device extraction stopped"
                  : "Extracted on this device"
            }
          />
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="metrics" data-metrics={JSON.stringify(metrics)}>
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-control border border-line bg-surface-2 px-3 py-2.5">
              <dt className={EYEBROW}>{k}</dt>
              <dd className={`${DISPLAY_NUM} mt-1 text-xl`}>{v}</dd>
            </div>
          ))}
        </dl>
        {rows.length > 0 && !extracting && !partial && <HealthSnapshot rows={rows} />}
        {/* Dari flag lokal — tampil apa pun status cloud (terkunci/offline/gagal); ExplanationView tidak mengulangnya. */}
        <CriticalBanner rows={rows} />
        {partial && (
          <p className={`${CALLOUT.warn} flex items-start gap-2`} data-testid="partial">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            Partial: {partial}
          </p>
        )}
        <ResultsTable rows={rows} loading={extracting} partial={!!partial} />
        {rows.length > 0 && <MedicalDisclaimer />}
      </div>
    </section>
  );
}
