import { useId, useState } from "react";
import { matchExplanations } from "@/lib/ai/explanation";
import type { ExplainLanguage, ExplanationResult, LabTestResult } from "@/lib/ai/schemas";
import { FlagBadge } from "./FlagBadge";
import { QuestionIcon } from "./icons";
import { MedicalDisclaimer } from "./MedicalDisclaimer";
import { RangeBar, RangeScaleNote } from "./RangeBar";
import { BTN_SECONDARY, DISPLAY_NUM, EYEBROW, LIFT } from "./ui";

interface ExplanationViewProps {
  explanation: ExplanationResult;
  /** Baris lokal saat penjelasan diminta — sumber flag (dihitung dari rentang rujukan di perangkat). */
  rows: readonly LabTestResult[];
  /** Indeks baris yang benar-benar dikirim; hanya baris ini yang boleh menerima penjelasan. */
  sentIndices: readonly number[];
  language: ExplainLanguage;
}

const RANK: Readonly<Record<LabTestResult["flag"], number>> = { critical: 0, high: 1, low: 1, normal: 2, unknown: 3 };

const CARD_TONE: Readonly<Record<LabTestResult["flag"], string>> = {
  critical: "border-danger/60",
  high: "border-warn/50",
  low: "border-low/50",
  normal: "border-line",
  unknown: "border-line",
};

/**
 * Penjelasan terstruktur: teks dari model, flag dari ekstraksi lokal, disclaimer dari kode.
 * Banner critical dirender page dari baris lokal (tidak bergantung pada cloud), jadi tidak diulang di sini.
 * Dipasang di dalam section ber-h2 → heading mulai h3.
 */
export function ExplanationView({ explanation, rows, sentIndices, language }: ExplanationViewProps) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const matched = matchExplanations(rows, explanation.perTest, sentIndices);
  // Abnormal dulu (critical → high/low), sisanya bisa dilipat. Indeks asli dipertahankan untuk pencocokan penjelasan.
  const order = rows.map((_, i) => i).sort((a, b) => RANK[rows[a].flag] - RANK[rows[b].flag] || a - b);
  const flaggedIdx = order.filter((i) => RANK[rows[i].flag] < RANK.normal);
  const restIdx = order.filter((i) => RANK[rows[i].flag] >= RANK.normal);
  const flagged = flaggedIdx.length;
  // Tanpa baris abnormal tidak ada yang dilipat.
  const collapsible = flagged > 0 && restIdx.length > 0;
  const visible = collapsible && !showAll ? flaggedIdx : order;
  const allNormal = restIdx.every((i) => rows[i].flag === "normal");

  return (
    <section aria-labelledby="explanation-heading" className="flex flex-col gap-5 motion-safe:animate-enter" data-testid="explanation">
      <div className="relative flex flex-col gap-2 overflow-hidden rounded-card border border-cloud/40 bg-cloud-soft p-5 shadow-glow-cloud">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cloud to-transparent" />
        <p className={`${EYEBROW} text-cloud-ink`}>
          Gemini · {rows.length} tests · {flagged} outside the reference range
        </p>
        <h3 id="explanation-heading" className="text-xl font-semibold tracking-tight">
          Your results, explained
        </h3>
        <p lang={language} className="text-base leading-relaxed" data-testid="explanation-summary">
          {explanation.summary}
        </p>
      </div>

      <ul id={listId} className="grid gap-3 sm:grid-cols-2" aria-label={`Explanation per test, ${visible.length} of ${rows.length} shown`} data-testid="explanation-cards">
        {visible.map((i) => {
          const r = rows[i];
          const ex = matched[i];
          return (
            <li key={`${i}-${r.testName}`} className={`flex flex-col gap-2.5 rounded-card border bg-surface p-4 motion-safe:animate-enter ${LIFT} ${CARD_TONE[r.flag]}`}>
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold leading-snug">{r.testName}</h4>
                <FlagBadge flag={r.flag} />
              </div>
              <p className="text-sm">
                <span className={`${DISPLAY_NUM} text-2xl`}>{r.value}</span> <span className="text-muted">{r.unit}</span>
                {r.referenceRange && <span className="block font-mono text-xs text-muted">Reference {r.referenceRange}</span>}
              </p>
              <RangeBar value={r.value} unit={r.unit} range={r.referenceRange} flag={r.flag} />

              {ex ? (
                <p lang={language} className="text-sm leading-relaxed">
                  {ex.explanation}
                </p>
              ) : (
                <p className="text-sm text-muted">
                  {sentIndices.includes(i)
                    ? "The cloud returned no explanation for this row."
                    : "Not sent to the cloud (not in the lab-test dictionary or value format), so there is no explanation for this row."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <RangeScaleNote />
      {collapsible && (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((v) => !v)}
          className={`${BTN_SECONDARY} self-start`}
          data-testid="explanation-toggle"
        >
          {showAll
            ? `Show only the ${flagged} result${flagged === 1 ? "" : "s"} outside the range`
            : `Show ${restIdx.length} ${allNormal ? "normal" : "other"} result${restIdx.length === 1 ? "" : "s"}`}
        </button>
      )}

      <div className="rounded-card border border-line bg-surface-2 p-4">
        <h4 className="flex items-center gap-2 font-semibold">
          <span className="text-cloud-ink">
            <QuestionIcon size={18} />
          </span>
          Questions to ask your doctor
        </h4>
        <ol lang={language} className="mt-2 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed marker:text-muted" data-testid="doctor-questions">
          {explanation.doctorQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>

      <MedicalDisclaimer language={language} />
    </section>
  );
}
