import type { SentPayload } from "@/lib/ai/router";
import type { LabTestResult } from "@/lib/ai/schemas";
import type { CloudPayload, DropReason, FallbackPayload } from "@/lib/pii";
import { CheckIcon } from "./icons";
import { LocationTag } from "./LocationTag";
import { CONSOLE_PRE } from "./ui";

/** Pratinjau payload dari buildCloudPayload yang sama dengan yang dipakai tombol Explain. */
export type PayloadPreview =
  | { state: "unavailable"; reason: string }
  | { state: "ready"; payload: CloudPayload }
  | { state: "blocked"; kinds: readonly string[] }
  | { state: "empty"; message: string };

/** Pratinjau fallback ekstraksi cloud (buildFallbackText yang sama dengan tombol "Extract via private cloud"). */
export type FallbackPreview = { state: "ready"; payload: FallbackPayload } | { state: "locked"; reason: string };

const DROP_REASON: Readonly<Record<DropReason, string>> = {
  unknown_test: "test name not in the lab-test dictionary",
  value_not_allowed: "value is not a plain number or known qualifier",
  row_limit: "over the 60-row limit",
};

const LANGUAGE_LABEL = { en: "English", id: "Bahasa Indonesia" } as const;

export const fmtBytes = (n: number) => `${n.toLocaleString("en-US")} B`;

function Meta({ items }: { items: readonly [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-control border border-line bg-surface-2 p-2.5 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted">{k}</dt>
          <dd className="truncate font-mono font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PayloadText({ text, label, testId }: { text: string; label: string; testId: string }) {
  return (
    <pre tabIndex={0} aria-label={label} className={`max-h-64 ${CONSOLE_PRE}`} data-testid={testId}>
      {text}
    </pre>
  );
}

function Heading({ id, children, sent }: { id: string; children: string; sent?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={id} className="text-sm font-semibold">
        {children}
      </h4>
      <LocationTag where={sent ? "cloud" : "device"} label={sent ? "Left the device" : "Still on this device"} />
    </div>
  );
}

interface PayloadInspectorProps {
  preview: PayloadPreview;
  /** Payload terakhir yang benar-benar diteruskan ke SDK (dari event routing). */
  sent: SentPayload | null;
  /** Baris lokal — hanya untuk menamai baris yang di-drop (tidak dikirim ke mana pun). */
  rows: readonly LabTestResult[];
  /** Hanya saat Gemini Nano tidak tersedia/gagal dan fallback ekstraksi cloud ditawarkan. */
  fallback?: FallbackPreview | null;
}

/** US-10: payload persis SEBELUM kirim (pratinjau) dan SESUDAH kirim (teks yang diteruskan ke generateContent). */
export function PayloadInspector({ preview, sent, rows, fallback }: PayloadInspectorProps) {
  const previewText = sent?.step === "extract" ? (fallback?.state === "ready" ? fallback.payload.text : null) : preview.state === "ready" ? preview.payload.text : null;
  const identical = sent && previewText !== null ? sent.text === previewText : null;
  return (
    <div className="flex flex-col gap-5 text-sm">
      {fallback && (
        <section aria-labelledby="fallback-before" className="flex flex-col gap-2">
          <Heading id="fallback-before">Before sending — private cloud extraction</Heading>
          {fallback.state === "locked" ? (
            <p className="text-warn-ink">{fallback.reason}</p>
          ) : (
            <>
              <Meta
                items={[
                  ["Lines sent", String(fallback.payload.lines)],
                  ["Lines removed", String(fallback.payload.droppedLines)],
                  ["Image", "not sent"],
                  ["Size", fmtBytes(fallback.payload.bytes)],
                ]}
              />
              <PayloadText text={fallback.payload.text} label="Cloud extraction payload preview" testId="fallback-preview" />
            </>
          )}
        </section>
      )}

      <section aria-labelledby="payload-before" className="flex flex-col gap-2">
        <Heading id="payload-before">Before sending — explanation preview</Heading>
        {preview.state === "unavailable" && <p className="text-muted">{preview.reason}</p>}
        {preview.state === "empty" && <p className="text-muted">{preview.message}</p>}
        {preview.state === "blocked" && <p className="text-danger-ink">The PII guard would block this payload ({preview.kinds.join(", ")}). Nothing can be sent.</p>}
        {preview.state === "ready" && (
          <>
            <Meta
              items={[
                ["Rows sent", String(preview.payload.sentRows)],
                ["Rows kept local", String(preview.payload.droppedRows)],
                ["Language", LANGUAGE_LABEL[preview.payload.language]],
                ["Size", fmtBytes(preview.payload.bytes)],
              ]}
            />
            <PayloadText text={preview.payload.text} label="Cloud payload preview" testId="payload-preview" />
            {preview.payload.dropped.length > 0 && (
              <div>
                <p className="text-xs font-medium">Kept on this device (not sent):</p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted" data-testid="payload-dropped">
                  {preview.payload.dropped.map((d) => (
                    <li key={d.index}>
                      Row {d.index + 1}
                      {rows[d.index] ? ` · ${rows[d.index].testName}` : ""} — {DROP_REASON[d.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="payload-after" className="flex flex-col gap-2">
        <Heading id="payload-after" sent>
          After sending — exact text sent
        </Heading>
        {!sent ? (
          <p className="text-muted">Nothing has been sent to the cloud yet.</p>
        ) : (
          <>
            <Meta
              items={[
                ["Step", sent.step === "extract" ? "Read report (masked text)" : "Explain"],
                ["Model", sent.model],
                [sent.step === "extract" ? "Lines" : "Rows", String(sent.rows)],
                ["Language", sent.language ? LANGUAGE_LABEL[sent.language] : "–"],
                ["Size", fmtBytes(sent.bytes)],
              ]}
            />
            {identical !== null && (
              <p className={`flex items-center gap-1.5 text-xs ${identical ? "text-ok-ink" : "text-warn-ink"}`} data-testid="payload-identical">
                {identical && <CheckIcon size={14} />}
                {identical ? "Identical to the current preview." : "Differs from the current preview (rows or language changed since)."}
              </p>
            )}
            <PayloadText text={sent.text} label="Cloud payload as sent" testId="payload-sent" />
            <p className="text-xs text-muted">
              {sent.step === "extract"
                ? "Sent through Firebase AI Logic with App Check, together with the JSON response schema. Only the masked OCR text of the results table — no image, no report header or footer, identity data replaced by placeholders."
                : "Sent through Firebase AI Logic with App Check, together with the JSON response schema. No image, OCR text or identity data is included."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
