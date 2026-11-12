import type { PiiSpanKind } from "./types";

/** Huruf yang sering tertukar dengan angka oleh OCR. Pemetaan 1:1 karakter → offset string tetap sama. */
const CONFUSABLE: Readonly<Record<string, string>> = {
  O: "0",
  o: "0",
  D: "0",
  Q: "0",
  l: "1",
  I: "1",
  i: "1",
  "|": "1",
  "!": "1",
  S: "5",
  s: "5",
  B: "8",
  Z: "2",
  z: "2",
};

/**
 * Ganti huruf mirip-angka (O↔0, l/I↔1, S↔5, B↔8, Z↔2) di token yang dominan angka (≥3 digit, huruf mirip
 * tidak lebih banyak dari digit). Token kata biasa ("No.", "Sp.PD") tidak berubah. Panjang string tetap.
 */
export function digitize(token: string): string {
  const digits = (token.match(/\d/g) ?? []).length;
  if (digits < 3) return token;
  const conv = [...token].filter((c) => c in CONFUSABLE).length;
  if (conv === 0 || conv > digits) return token;
  return [...token].map((c) => CONFUSABLE[c] ?? c).join("");
}

export interface PatternRule {
  kind: PiiSpanKind;
  re: RegExp;
  /** true → dijalankan pada teks yang sudah di-digitize. */
  numeric: boolean;
  /** Validasi tambahan atas teks cocok (mis. tanggal masuk akal). */
  valid?: (m: string) => boolean;
}

const MONTHS =
  "jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|" +
  "agu(?:stus)?|agt|aug(?:ust)?|sep(?:t|tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?";

function plausibleDate(m: string): boolean {
  const parts = m.split(/[/.\-\s]+/).map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return true; // varian nama bulan
  const [a, b, c] = parts;
  if (a > 1000) return b >= 1 && b <= 12 && c >= 1 && c <= 31; // yyyy-mm-dd
  // dd/mm atau mm/dd: salah satu ≤ 12, keduanya ≤ 31
  return a >= 1 && b >= 1 && a <= 31 && b <= 31 && (a <= 12 || b <= 12);
}

/** Pola PII tanpa label. Dipakai detektor (di seluruh halaman) dan guard sebelum kirim cloud. */
export const PATTERN_RULES: readonly PatternRule[] = [
  // NIK 16 digit: rapat, atau dikelompokkan 6-6-4 / 4-4-4-4 dengan spasi/titik/strip.
  {
    kind: "nik",
    numeric: true,
    re: /(?<![\d])(?:\d{16}|\d{6}[ .-]\d{6}[ .-]\d{4}|\d{4}[ .-]\d{4}[ .-]\d{4}[ .-]\d{4})(?![\d])/g,
  },
  { kind: "email", numeric: false, re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Telepon: seluler ID (08…/+62 8…), PSTN ID ((022) 555-0199, 022-5550199), format US.
  {
    kind: "phone",
    numeric: true,
    re: /(?<![\d])(?:(?:\+?62|0)\s?8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{2,5}|\(0\d{1,3}\)\s?\d{3,4}[\s.-]?\d{3,5}|0\d{2,3}[\s-]\d{6,8}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[.-]\d{3}[.-]\d{4})(?![\d])/g,
  },
  {
    kind: "date",
    numeric: true,
    // dd/mm/yyyy, yyyy-mm-dd, dan tahun 2 digit dengan pemisah yang sama (14/08/91, 14-08-91, 14.08.91).
    re: /(?<![\d.,/-])(?:\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}|(?:19|20)\d{2}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}([/.-])\d{1,2}\1\d{2})(?![\d/.-]\d)/g,
    valid: plausibleDate,
  },
  {
    kind: "date",
    numeric: false,
    // "14 Agustus 1991", "5th March 1990", "March 5th, 1990", "Maret 1990".
    re: new RegExp(
      `\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]+(?:${MONTHS})\\.?,?[\\s-]+(?:19|20)\\d{2}\\b` +
        `|\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b` +
        `|\\b(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`,
      "gi",
    ),
  },
  // No. RM berprefiks (RM-2024-087531, mrn 123456, REG/…) — juga atas teks ter-digitize (RM-2O24-O87531).
  { kind: "medical_record_number", numeric: true, re: /\b(?:RM|MRN|REG)[\s:.#/-]{0,2}\d[\d/-]{3,}\b/gi },
  // Nama bergelar dokter: "dr. Andi Wijaya, Sp.PD"
  {
    kind: "doctor",
    numeric: false,
    re: /\b(?:dr|drg|Dr|DR|Prof)\.?\s+[A-Z][\w'’.-]*,?(?:\s+(?:[A-Z][\w'’.-]*|Sp\.?\s?[A-Z]{1,4}|M\.?\s?[A-Za-z]{2,4}\.?),?){0,5}/g,
  },
];

export interface LabelDef {
  tokens: readonly string[];
  /** null = hanya pembatas (label lain yang bukan PII, mis. "Sex", "Tgl Periksa"). */
  kind: PiiSpanKind | null;
  /** Kata umum → harus diikuti ":" agar dianggap label. */
  needsColon?: boolean;
}

const L = (kind: PiiSpanKind | null, needsColon: boolean, ...phrases: string[]): LabelDef[] =>
  phrases.map((p) => ({ tokens: p.split(" "), kind, needsColon }));

/** Label kepala laporan (token sudah dinormalisasi: huruf kecil, tanpa titik/titik dua di ujung). */
export const LABELS: readonly LabelDef[] = [
  ...L("name", false, "nama pasien", "nama lengkap", "patient name", "nama"),
  ...L("name", true, "name", "patient", "pasien"),
  ...L("nik", false, "nik", "no ktp", "no nik", "nik/ktp", "nomor induk kependudukan"),
  ...L(
    "medical_record_number",
    false,
    "no rm",
    "no rekam medis",
    "nomor rekam medis",
    "rekam medis",
    "mrn",
    "no lab",
    "lab no",
    "no reg",
    "no registrasi",
    "patient id",
    "id pasien",
    "no pasien",
    "medical record",
    "specimen id",
    "no sampel",
    "accession",
    "accession no",
  ),
  ...L("medical_record_number", true, "rm"),
  ...L("date_of_birth", false, "tgl lahir", "tanggal lahir", "tempat/tgl lahir", "tempat tgl lahir", "ttl", "dob", "date of birth", "birth date"),
  ...L("address", false, "alamat", "address"),
  ...L("phone", false, "no telp", "telp", "telepon", "no telepon", "no hp", "phone", "nomor hp"),
  ...L("phone", true, "hp", "tel", "mobile"),
  ...L("email", false, "email", "e-mail"),
  ...L("doctor", false, "dokter pengirim", "dokter perujuk", "ordering physician", "referring physician", "dpjp"),
  ...L("doctor", true, "dokter", "pengirim", "perujuk", "physician", "referring", "doctor"),
  ...L("facility", false, "faskes", "puskesmas", "rumah sakit", "asal rujukan", "facility"),
  ...L("facility", true, "klinik", "rs", "hospital", "instansi"),
  ...L(null, false, "jenis kelamin", "tgl periksa", "tanggal periksa", "tgl sampel", "tgl terima", "umur", "usia"),
  ...L(null, true, "sex", "jk", "age", "collected", "reported", "received", "ruang", "kelas", "penjamin"),
].sort((a, b) => b.tokens.length - a.tokens.length);

/** Semua token label — dipakai sebagai daftar putih kata yang boleh tampil di zona header. */
export const LABEL_TOKENS: ReadonlySet<string> = new Set(LABELS.flatMap((l) => l.tokens));

/** Kata kolom header tabel hasil; baris dengan ≥2 kata berbeda = batas zona kepala laporan. */
export const TABLE_HEADER_WORDS: ReadonlySet<string> = new Set([
  "pemeriksaan",
  "test",
  "tes",
  "hasil",
  "result",
  "results",
  "parameter",
  "satuan",
  "unit",
  "units",
  "rujukan",
  "reference",
  "range",
  "flag",
  "nilai",
  "keterangan",
  "metode",
  "method",
]);

/** Kosakata judul generik (jenis pemeriksaan) yang boleh tetap terlihat di zona header. */
export const GENERIC_TITLE_WORDS: ReadonlySet<string> = new Set([
  ...TABLE_HEADER_WORDS,
  "laboratorium", "laboratory", "lab", "hematologi", "hematology", "kimia", "darah", "lengkap", "rutin",
  "urin", "urinalisis", "urinalysis", "lipid", "panel", "profil", "profile", "glucose", "glukosa", "gula", "fasting",
  "puasa", "sewaktu", "hemoglobin", "a1c", "hba1c", "report", "laporan", "complete", "blood", "count", "cbc", "serologi",
  "imunologi", "fungsi", "hati", "ginjal", "liver", "kidney", "function", "chemistry", "metabolic", "basic",
  "comprehensive", "thyroid", "tiroid", "elektrolit", "electrolytes", "and", "dan", "of",
]);

/** Normalisasi token label: huruf kecil, tanpa diakritik, tanpa tanda baca di ujung. */
export function labelToken(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
