import { DISCLAIMER } from "@/lib/ai/explanation";
import type { ExplainLanguage } from "@/lib/ai/schemas";

/** Teks tetap dari kode — tidak pernah dari model. Bahasa penjelasan "id" → tampilkan juga terjemahannya. */
export function MedicalDisclaimer({ language = "en" }: { language?: ExplainLanguage }) {
  return (
    <aside
      aria-label="Medical disclaimer"
      className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      data-testid="disclaimer"
    >
      <p className="font-medium">{DISCLAIMER.en}</p>
      {language === "id" && (
        <p lang="id" className="mt-1 text-zinc-600 dark:text-zinc-400">
          {DISCLAIMER.id}
        </p>
      )}
    </aside>
  );
}
