import { useId } from "react";
import { EXPLAIN_LANGUAGES, type ExplainLanguage } from "@/lib/ai/schemas";
import { ExplanationView } from "../ExplanationView";
import { AlertIcon, CloudIcon, SpinnerIcon } from "../icons";
import { LocationTag } from "../LocationTag";
import { BTN_CLOUD, CALLOUT, CARD, CARD_BODY, H2, MUTED } from "../ui";
import { type ExplainState, LANGUAGE_LABEL } from "./types";

interface ExplainCardProps {
  explain: ExplainState;
  language: ExplainLanguage;
  onLanguageChange: (l: ExplainLanguage) => void;
  disabled: boolean;
  /** Ditampilkan sebagai teks bantu terlihat dan dikaitkan ke tombol lewat aria-describedby. */
  disabledReason: string | null;
  hasResult: boolean;
  onExplain: () => void;
}

/** Langkah 4: penjelasan bahasa awam di cloud (hanya baris anonim, dicek guard). */
export function ExplainCard({ explain, language, onLanguageChange, disabled, disabledReason, hasResult, onExplain }: ExplainCardProps) {
  const running = explain.status === "running";
  const reasonId = useId();
  const reason = disabled && !running ? disabledReason : null;
  return (
    <section aria-labelledby="explain-heading" className={CARD}>
      <div className={CARD_BODY}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="explain-heading" className={H2}>
            Explain in plain language
          </h2>
          <LocationTag where="cloud" label="Gemini in the cloud" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <fieldset className="flex flex-col gap-1.5" disabled={running}>
            <legend className={`mb-1.5 text-xs font-medium ${MUTED}`}>Explanation language</legend>
            <div className="inline-flex w-fit rounded-control border border-line-strong bg-surface-2 p-0.5">
              {EXPLAIN_LANGUAGES.map((l) => (
                <label
                  key={l}
                  className="cursor-pointer rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm text-muted has-checked:bg-surface has-checked:font-medium has-checked:text-ink has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-focus"
                >
                  <input type="radio" className="sr-only" name="explain-language" value={l} checked={language === l} onChange={() => onLanguageChange(l)} />
                  {LANGUAGE_LABEL[l]}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className={`${BTN_CLOUD} self-start sm:self-auto`}
            disabled={disabled}
            aria-describedby={reason ? reasonId : undefined}
            onClick={onExplain}
          >
            {running ? <SpinnerIcon size={16} /> : <CloudIcon size={16} />}
            {running ? "Explaining…" : "Explain (cloud)"}
          </button>
        </div>
        {reason && (
          <p id={reasonId} className="text-xs font-medium text-warn-ink" data-testid="explain-disabled-reason">
            Explain is unavailable: {reason}
          </p>
        )}
        <p className={`text-xs ${MUTED}`}>
          Only rows with a known test name and a plain value/unit/range are sent, and the PII guard checks them again. Open “Inspect cloud payload” to see the
          exact text first.
        </p>
        <div aria-live="polite" className="empty:hidden">
          {running && (
            <p className={`flex items-center gap-2 text-sm ${MUTED}`}>
              <SpinnerIcon size={16} className="text-cloud" />
              Asking Gemini in the cloud…
            </p>
          )}
          {explain.status === "blocked" && (
            <p className={`${CALLOUT.danger} flex items-start gap-2`} role="alert">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              Blocked before sending: the payload still contained identity data ({explain.kinds.join(", ")}). Nothing left the device.
            </p>
          )}
          {(explain.status === "error" || explain.status === "unsent") && (
            <p className={`${CALLOUT.danger} flex items-start gap-2`} role="alert">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              {explain.message}
            </p>
          )}
        </div>
        {running && (
          <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-control border border-line p-3.5">
                <span className="h-3.5 w-1/2 rounded bg-line motion-safe:animate-pulse" />
                <span className="h-3 w-full rounded bg-line motion-safe:animate-pulse" />
                <span className="h-3 w-4/5 rounded bg-line motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        )}
        {explain.status === "idle" && !hasResult && (
          <p className={`rounded-control border border-dashed border-line-strong p-3 text-sm ${MUTED}`}>
            Explanations appear here. You will see the exact payload before anything is sent.
          </p>
        )}
        {explain.status === "done" && (
          <ExplanationView explanation={explain.explanation} rows={explain.rows} sentIndices={explain.sentIndices} language={explain.language} />
        )}
      </div>
    </section>
  );
}
