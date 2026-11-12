import { DISCLAIMER } from "@/lib/ai/explanation";
import type { ExplainLanguage } from "@/lib/ai/schemas";
import { InfoIcon } from "./icons";

/** Teks tetap dari kode — tidak pernah dari model. Bahasa penjelasan "id" → tampilkan juga terjemahannya. */
export function MedicalDisclaimer({ language = "en" }: { language?: ExplainLanguage }) {
  return (
    <aside aria-label="Medical disclaimer" className="flex gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink" data-testid="disclaimer">
      <span className="mt-0.5 shrink-0 text-muted">
        <InfoIcon size={16} />
      </span>
      <div>
        <p className="font-medium">{DISCLAIMER.en}</p>
        {language === "id" && (
          <p lang="id" className="mt-1 text-muted">
            {DISCLAIMER.id}
          </p>
        )}
      </div>
    </aside>
  );
}
