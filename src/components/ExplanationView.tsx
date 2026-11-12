import { matchExplanations } from "@/lib/ai/explanation";
import type { ExplainLanguage, ExplanationResult, LabTestResult } from "@/lib/ai/schemas";
import { FlagBadge } from "./FlagBadge";
import { MedicalDisclaimer } from "./MedicalDisclaimer";

interface ExplanationViewProps {
  explanation: ExplanationResult;
  /** Baris lokal saat penjelasan diminta — sumber flag (dihitung dari rentang rujukan di perangkat). */
  rows: readonly LabTestResult[];
  /** Indeks baris yang benar-benar dikirim; hanya baris ini yang boleh menerima penjelasan. */
  sentIndices: readonly number[];
  language: ExplainLanguage;
}

/**
 * Penjelasan terstruktur: teks dari model, flag dari ekstraksi lokal, disclaimer dari kode.
 * Banner critical dirender page dari baris lokal (tidak bergantung pada cloud), jadi tidak diulang di sini.
 * Dipasang di dalam section ber-h2 → heading mulai h3.
 */
export function ExplanationView({ explanation, rows, sentIndices, language }: ExplanationViewProps) {
  const matched = matchExplanations(rows, explanation.perTest, sentIndices);

  return (
    <section aria-labelledby="explanation-heading" className="flex flex-col gap-4" data-testid="explanation">
      <h3 id="explanation-heading" className="text-lg font-semibold">
        Your results, explained
      </h3>

      <p lang={language} className="text-base leading-relaxed" data-testid="explanation-summary">
        {explanation.summary}
      </p>

      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Explanation per test" data-testid="explanation-cards">
        {rows.map((r, i) => {
          const ex = matched[i];
          return (
            <li key={`${i}-${r.testName}`} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium">{r.testName}</h4>
                <FlagBadge flag={r.flag} />
              </div>
              <p className="text-sm">
                <span className="font-mono text-base font-semibold">{r.value}</span> {r.unit}
                {r.referenceRange && <span className="text-zinc-600 dark:text-zinc-400"> · range {r.referenceRange}</span>}
              </p>
              {ex ? (
                <p lang={language} className="text-sm leading-relaxed">
                  {ex.explanation}
                </p>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {sentIndices.includes(i)
                    ? "The cloud returned no explanation for this row."
                    : "Not sent to the cloud (not in the lab-test dictionary or value format), so there is no explanation for this row."}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <h4 className="font-medium">Questions to ask your doctor</h4>
        <ol lang={language} className="mt-2 list-decimal space-y-1 pl-6 text-sm leading-relaxed" data-testid="doctor-questions">
          {explanation.doctorQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>

      <MedicalDisclaimer language={language} />
    </section>
  );
}
