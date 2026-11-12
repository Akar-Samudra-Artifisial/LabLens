import { ALLOWLIST_WORDS, type CloudRowInput, sanitizeForCloud } from "./allowlist";
import { assertNoPii, normWords } from "./guard";
import type { KnownPii } from "./redact";

export const EXPLAIN_PROMPT = "Jelaskan hasil lab berikut dalam bahasa Indonesia awam, singkat, tanpa diagnosis:\n";

export interface CloudPayload {
  /** Teks final yang akan dikirim apa adanya (EXPLAIN_PROMPT + JSON baris). */
  text: string;
  sentRows: number;
  droppedRows: number;
}

const vocabOnly = (s: string) => {
  const w = normWords(s);
  return w !== "" && w.split(" ").every((x) => ALLOWLIST_WORDS.has(x));
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
  const docOnly: KnownPii = { phrases: known.phrases.filter((p) => !vocabOnly(p)), tokens: known.tokens.filter((t) => !vocabOnly(t)) };
  assertNoPii(text.startsWith(EXPLAIN_PROMPT) ? text.slice(EXPLAIN_PROMPT.length) : text, docOnly);
}

/**
 * Susun payload penjelasan cloud: allowlist per field (lihat allowlist.ts) lalu guard PII atas teks final.
 * Gagal guard → PiiLeakError (tidak ada payload). Tidak ada baris lolos → Error (tidak ada yang perlu dikirim).
 */
export function buildCloudPayload(results: readonly CloudRowInput[], known?: KnownPii): CloudPayload {
  const { rows, dropped } = sanitizeForCloud(results);
  if (rows.length === 0) throw new Error("Tidak ada baris hasil yang lolos allowlist — tidak ada yang dikirim ke cloud.");
  const text = EXPLAIN_PROMPT + JSON.stringify(rows);
  assertPayloadClean(text, known);
  return { text, sentRows: rows.length, droppedRows: dropped };
}
