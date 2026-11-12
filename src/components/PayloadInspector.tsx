import type { SentPayload } from "@/lib/ai/router";
import type { LabTestResult } from "@/lib/ai/schemas";
import type { CloudPayload, DropReason, FallbackPayload } from "@/lib/pii";

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
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-zinc-600 dark:text-zinc-400">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PayloadText({ text, label, testId }: { text: string; label: string; testId: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-100 p-2 font-mono text-xs text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-zinc-100"
      data-testid={testId}
    >
      {text}
    </pre>
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
    <div className="flex flex-col gap-4 text-sm">
      {fallback && (
        <section aria-labelledby="fallback-before" className="flex flex-col gap-2">
          <h4 id="fallback-before" className="font-medium">
            Before sending — private cloud extraction
          </h4>
          {fallback.state === "locked" ? (
            <p className="text-amber-800 dark:text-amber-300">{fallback.reason}</p>
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
        <h4 id="payload-before" className="font-medium">
          Before sending — explanation preview
        </h4>
        {preview.state === "unavailable" && <p className="text-zinc-600 dark:text-zinc-400">{preview.reason}</p>}
        {preview.state === "empty" && <p className="text-zinc-600 dark:text-zinc-400">{preview.message}</p>}
        {preview.state === "blocked" && (
          <p className="text-red-700 dark:text-red-400">
            The PII guard would block this payload ({preview.kinds.join(", ")}). Nothing can be sent.
          </p>
        )}
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
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-700 dark:text-zinc-300" data-testid="payload-dropped">
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
        <h4 id="payload-after" className="font-medium">
          After sending — exact text sent
        </h4>
        {!sent ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing has been sent to the cloud yet.</p>
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
              <p className="text-xs" data-testid="payload-identical">
                {identical ? "✓ Identical to the current preview." : "Differs from the current preview (rows or language changed since)."}
              </p>
            )}
            <PayloadText text={sent.text} label="Cloud payload as sent" testId="payload-sent" />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
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
