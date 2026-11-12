import { type PiiSpanKind, SPAN_KIND_LABEL } from "@/lib/pii";
import { AlertIcon, ShieldIcon } from "../icons";
import { CALLOUT, CARD, CARD_BODY, H2, MUTED, PRE } from "../ui";
import type { OcrView } from "./types";

export const BADGE_TONE = {
  danger: "border-danger/50 bg-danger-soft text-danger-ink",
  warn: "border-warn/50 bg-warn-soft text-warn-ink",
  ok: "border-ok/40 bg-ok-soft text-ok-ink",
  neutral: "border-line-strong bg-surface-2 text-muted",
} as const;

interface RedactedCardProps {
  ocr: OcrView | null;
  /** OCR + aturan PII sedang berjalan di perangkat. */
  reading: boolean;
  badge: { tone: string; text: string };
}

/** Gambar & teks hasil masking di perangkat + badge status cloud. */
export function RedactedCard({ ocr, reading, badge }: RedactedCardProps) {
  const piiChips = ocr ? Object.entries(ocr.counts).filter(([, n]) => (n ?? 0) > 0) : [];
  return (
    <section className={CARD} data-testid="redacted-panel" aria-labelledby="redacted-heading">
      <div className={CARD_BODY}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="redacted-heading" className={`${H2} flex items-center gap-2`}>
            <span className="text-device-ink">
              <ShieldIcon size={18} />
            </span>
            Redacted on device
          </h2>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.tone}`} data-testid="cloud-badge">
            {badge.text}
          </span>
        </div>
        {ocr?.reviewRequired && (
          <p className={`${CALLOUT.warn} flex items-start gap-2`} role="alert">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            The results table boundary was not found, so the report header (name, ID number, etc.) cannot be confirmed as redacted. Cloud explanation is disabled
            for this document — check the redacted image manually.
          </p>
        )}
        {!ocr &&
          (reading ? (
            <>
              <p className="sr-only">OCR and PII rules running on this device…</p>
              <div className="grid gap-3 md:grid-cols-2" aria-hidden="true">
                <div className="h-48 rounded-control bg-line motion-safe:animate-pulse" />
                <div className="flex flex-col gap-2">
                  {["w-3/4", "w-full", "w-5/6", "w-2/3", "w-4/5"].map((w) => (
                    <span key={w} className={`h-3 rounded bg-line motion-safe:animate-pulse ${w}`} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className={`text-sm ${MUTED}`}>
              No document yet. After upload, the masked image and text appear here — names, ID numbers and other identity data are blacked out before anything
              else happens.
            </p>
          ))}
        {ocr && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL lokal, bukan aset Next */}
            <img src={ocr.imageUrl} alt="Preview of the redacted report image" className="w-full rounded-control border border-line bg-surface-2" />
            <div className="flex min-w-0 flex-col gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={MUTED}>
                  OCR + redaction <span className="font-mono text-ink">{ocr.ms} ms</span> · PII masked:
                </span>
                {piiChips.length === 0 ? (
                  <span className={MUTED}>none</span>
                ) : (
                  piiChips.map(([k, n]) => (
                    <span key={k} className="rounded-full border border-device/40 bg-device-soft px-2 py-0.5 font-medium text-device-ink">
                      {SPAN_KIND_LABEL[k as PiiSpanKind]} {n}
                    </span>
                  ))
                )}
              </div>
              <pre tabIndex={0} aria-label="Redacted OCR text" className={`max-h-72 ${PRE}`} data-testid="redacted-text">
                {ocr.text}
              </pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
