import { digitize, PATTERN_RULES } from "./patterns";
import type { KnownPii } from "./redact";

export class PiiLeakError extends Error {
  constructor(readonly kinds: readonly string[]) {
    // Pesan sengaja tanpa nilai PII — hanya jenisnya.
    super(`Pengiriman ke cloud diblokir: payload masih mengandung data identitas (${kinds.join(", ")}).`);
    this.name = "PiiLeakError";
  }
}

const LABEL_WORDS = String.raw`nama(?:\s+pasien)?|patient(?:\s+name)?|nik|ktp|no\.?\s?rm|mrn|no\.?\s?lab|lab\.?\s?no|no\.?\s?reg|tgl\.?\s?lahir|tanggal\s+lahir|dob|date\s+of\s+birth|alamat|address|no\.?\s?telp|no\.?\s?hp|phone|e-?mail`;

/** Label identitas diikuti ":"/"=" lalu nilai ("Nama: …", "No. Lab = 123"). */
const LABEL_WITH_COLON = new RegExp(String.raw`\b(?:${LABEL_WORDS})\s*[:=]\s*\S`, "i");

/**
 * Label tanpa ":" — hanya bila diikuti nilai berbentuk identitas: kata berhuruf kapital ("Nama Pasien Siti")
 * atau angka ("NIK 3273…", "No. Lab 2411"), agar kata biasa di kalimat tidak memicu blokir.
 */
const LABEL_NO_COLON = new RegExp(String.raw`\b(?:${LABEL_WORDS})\s+(\S+)`, "giu");

/** Kata sesudah label dicek tanpa flag i (dengan flag i, \p{Lu} juga cocok huruf kecil). */
function labelWithoutColon(text: string): boolean {
  for (const m of text.matchAll(LABEL_NO_COLON)) if (/^(?:\p{Lu}\p{Ll}|\d)/u.test(m[1])) return true;
  return false;
}

/** Digit Unicode apa pun (\p{Nd}: ٣, ३, 𝟑, …) → ASCII. Blok Nd selalu 10 kode berurutan mulai dari nol. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => {
    if (c >= "0" && c <= "9") return c;
    const cp = c.codePointAt(0) ?? 0;
    let start = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}

/** NFKC (fullwidth → ASCII), buang karakter format (zero-width, BOM, bidi), digit Unicode → ASCII. */
export function normalizeForGuard(s: string): string {
  return asciiDigits(s.normalize("NFKC").replace(/\p{Cf}/gu, ""));
}

/** Pemisah token: spasi dan tanda baca JSON — supaya `"value":"32730l54O8910002"` di-digitize per nilai. */
const TOKEN = /[^\s"',:{}[\]]+/g;

export const normWords = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Jenis PII yang ditemukan di teks (pola regex + nilai PII dokumen yang diketahui). Kosong = bersih. */
export function findPii(raw: string, known?: KnownPii): string[] {
  const kinds = new Set<string>();
  const text = normalizeForGuard(raw);
  const digitized = text.replace(TOKEN, digitize);
  for (const rule of PATTERN_RULES) {
    for (const m of (rule.numeric ? digitized : text).matchAll(rule.re)) {
      if (!rule.valid || rule.valid(m[0])) {
        kinds.add(rule.kind);
        break;
      }
    }
  }
  if (LABEL_WITH_COLON.test(text) || labelWithoutColon(text)) kinds.add("label");
  if (known) {
    const hay = ` ${normWords(text)} `;
    const words = new Set(hay.split(" "));
    const phraseHit = known.phrases.map(normWords).some((p) => p.replace(/ /g, "").length >= 4 && hay.includes(` ${p} `));
    const tokenHit = known.tokens.map(normWords).some((t) => t.length >= 4 && !t.includes(" ") && words.has(t));
    if (phraseHit || tokenHit) kinds.add("known");
  }
  return [...kinds];
}

/**
 * Guard terakhir sebelum panggilan cloud: jalankan ulang aturan PII atas payload final (string atau
 * objek → JSON). Ada yang cocok → lempar PiiLeakError dan pengiriman dibatalkan.
 */
export function assertNoPii(payload: unknown, known?: KnownPii): void {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const kinds = findPii(text, known);
  if (kinds.length > 0) throw new PiiLeakError(kinds);
}
