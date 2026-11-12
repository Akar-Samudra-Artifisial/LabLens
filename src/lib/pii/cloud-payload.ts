import { ALLOWLIST_WORDS, type CloudRow, type CloudRowInput, type DroppedRow, sanitizeForCloud } from "./allowlist";
import { assertNoPii, findPii, normWords } from "./guard";
import type { KnownPii } from "./redact";

/**
 * Bahasa output — enum tetap, SATU sumber kebenaran (ai/schemas.ts me-re-export sebagai EXPLAIN_LANGUAGES).
 * Tidak pernah teks bebas.
 */
export const PAYLOAD_LANGUAGES = ["en", "id"] as const;
export type PayloadLanguage = (typeof PAYLOAD_LANGUAGES)[number];

const LANGUAGE_NAME: Readonly<Record<PayloadLanguage, string>> = {
  en: "English",
  id: "Indonesian (Bahasa Indonesia)",
};

/**
 * Template prompt cloud (bahasa Inggris) + instruksi bahasa output. Hanya teks kode: tidak ada input pengguna selain
 * pilihan enum, jadi prompt tidak bisa membawa data dokumen. Kata-katanya sengaja menghindari label identitas
 * (lihat LABEL_WORDS di guard.ts) agar guard pola atas payload final tetap bisa dijalankan apa adanya.
 */
function explainPrompt(language: PayloadLanguage): string {
  return [
    "You help a layperson understand a lab report.",
    `Write every text field in ${LANGUAGE_NAME[language]}, using plain, calm, short sentences.`,
    "Do not diagnose any disease and do not recommend medication or doses.",
    "Return JSON that matches the response schema:",
    "- summary: 2-3 sentences about the overall picture.",
    "- perTest: one item per input row, in the same order; copy testName exactly from the row; explanation in 1-2 sentences " +
      "saying what the test measures and what this value means compared with its reference range.",
    "- The flag of each row was computed locally from the reference range; treat it as given.",
    "- doctorQuestions: 3-6 short questions to ask a doctor, focused on rows flagged low, high or critical; " +
      "if every row is normal, ask general prevention questions.",
    "- disclaimer: one sentence stating that this is not a medical diagnosis.",
    "Lab rows (JSON array, no personal data):",
    "",
  ].join("\n");
}

export const EXPLAIN_PROMPTS: Readonly<Record<PayloadLanguage, string>> = { en: explainPrompt("en"), id: explainPrompt("id") };
export const DEFAULT_PAYLOAD_LANGUAGE: PayloadLanguage = "en";
/** Prompt bahasa default (kompatibilitas: payload = EXPLAIN_PROMPT + JSON baris). */
export const EXPLAIN_PROMPT = EXPLAIN_PROMPTS[DEFAULT_PAYLOAD_LANGUAGE];

export interface CloudPayload {
  /** Teks final yang akan dikirim apa adanya (prompt bahasa terpilih + JSON baris). */
  text: string;
  language: PayloadLanguage;
  /** Ukuran `text` dalam byte UTF-8. */
  bytes: number;
  /** Baris yang dikirim (sudah allowlist; nama kanonik). */
  rows: CloudRow[];
  sentRows: number;
  /** Indeks baris input (0-based) yang benar-benar dikirim, sejajar dengan `rows`. */
  sentIndices: number[];
  droppedRows: number;
  /** Indeks + alasan baris yang tidak dikirim (tanpa teks dokumen). */
  dropped: DroppedRow[];
}

const vocabOnly = (s: string) => {
  const w = normWords(s);
  return w !== "" && w.split(" ").every((x) => ALLOWLIST_WORDS.has(x));
};

export const docOnly = (known: KnownPii): KnownPii => ({
  phrases: known.phrases.filter((p) => !vocabOnly(p)),
  tokens: known.tokens.filter((t) => !vocabOnly(t)),
});

/** Bagian data payload: prompt (teks kode) dilepas bila ada di depan. */
const dataPart = (text: string) => {
  const prompt = Object.values(EXPLAIN_PROMPTS).find((p) => text.startsWith(p));
  return prompt ? text.slice(prompt.length) : text;
};

/**
 * Guard atas payload final: pola PII di seluruh teks; nilai PII dokumen (`known`) hanya di bagian data —
 * prompt tetap ditulis kode, dan kata-katanya ("hasil", "Indonesia") bisa kebetulan muncul di kepala laporan.
 * Nilai `known` yang seluruhnya kosakata allowlist (legenda "H = High", "test") diabaikan: kata itu di payload berasal
 * dari kamus kode, bukan dari dokumen. Angka & kata lain dari dokumen tetap dicek.
 */
export function assertPayloadClean(text: string, known?: KnownPii): void {
  assertNoPii(text);
  if (!known) return;
  assertNoPii(dataPart(text), docOnly(known));
}

/** Jenis PII yang ditemukan guard di payload (aturan sama dengan assertPayloadClean). Kosong = bersih. */
export function payloadPiiKinds(text: string, known?: KnownPii): string[] {
  const kinds = new Set(findPii(text));
  if (known) for (const k of findPii(dataPart(text), docOnly(known))) kinds.add(k);
  return [...kinds];
}

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Susun payload penjelasan cloud: allowlist per field (lihat allowlist.ts) lalu guard PII atas teks final.
 * Gagal guard → PiiLeakError (tidak ada payload). Tidak ada baris lolos → Error (tidak ada yang perlu dikirim).
 */
export function buildCloudPayload(
  results: readonly CloudRowInput[],
  known?: KnownPii,
  language: PayloadLanguage = DEFAULT_PAYLOAD_LANGUAGE,
): CloudPayload {
  // Enum dicek saat runtime juga: nilai di luar daftar tidak pernah masuk ke prompt.
  if (!(PAYLOAD_LANGUAGES as readonly string[]).includes(language)) throw new Error(`Unsupported explanation language: ${String(language)}`);
  const { rows, sentIndices, dropped, droppedRows } = sanitizeForCloud(results);
  if (rows.length === 0) throw new Error("Tidak ada baris hasil yang lolos allowlist — tidak ada yang dikirim ke cloud.");
  const text = EXPLAIN_PROMPTS[language] + JSON.stringify(rows);
  assertPayloadClean(text, known);
  return { text, language, bytes: utf8Bytes(text), rows, sentRows: rows.length, sentIndices, droppedRows: dropped, dropped: droppedRows };
}
