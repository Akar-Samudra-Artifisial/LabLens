/** Kotak piksel (koordinat gambar yang di-OCR): x0,y0 kiri-atas; x1,y1 kanan-bawah. */
export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: Bbox;
  /** Kepercayaan OCR 0–100. */
  conf: number;
  /** Indeks baris OCR (lihat OcrPage.lines). */
  line: number;
}

export interface OcrLine {
  bbox: Bbox;
  /** Garis dasar teks; kemiringannya dipakai untuk mengoreksi foto miring. */
  baseline: Bbox;
}

/** Hasil OCR yang dinormalisasi (lepas dari format tesseract.js) — input modul PII. */
export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
  lines: OcrLine[];
}

export const PII_SPAN_KINDS = [
  "name",
  "nik",
  "medical_record_number",
  "date_of_birth",
  "date",
  "address",
  "phone",
  "email",
  "doctor",
  "facility",
  "header",
] as const;
export type PiiSpanKind = (typeof PII_SPAN_KINDS)[number];

export interface PiiSpan {
  kind: PiiSpanKind;
  /** Teks asli (hanya di memori lokal; jangan pernah dikirim/di-log). */
  text: string;
  bbox: Bbox;
  /** Indeks kata OCR yang tercakup. */
  words: number[];
}

/** Zona kepala laporan: semua yang berada di atas garis `top` (miring mengikuti `slope`). */
export interface HeaderZone {
  /** y garis batas di x = 0 (koordinat gambar). */
  y0: number;
  /** dy/dx garis batas (kemiringan foto). */
  slope: number;
  /** Indeks kata di dalam zona yang dibiarkan terlihat (judul generik). */
  keepWords: number[];
  /** Pita y (relatif garis miring) judul generik yang tidak dihitamkan. */
  keepBands: { top: number; bottom: number }[];
}

/** Zona kaki laporan: semua di bawah garis `y0` (miring mengikuti `slope`) — tanda tangan, verifikator, catatan. */
export interface FooterZone {
  y0: number;
  slope: number;
}

export interface PiiDetection {
  spans: PiiSpan[];
  zone: HeaderZone | null;
  footer: FooterZone | null;
  /**
   * Batas tabel tidak ditemukan (zona kepala tidak bisa ditentukan) → fail-closed: jangan kirim apa pun ke cloud
   * sampai pengguna meninjau manual.
   */
  reviewRequired: boolean;
  /** Indeks kata di zona kepala/kaki (selain judul generik) — disensor walau tak cocok aturan mana pun. */
  zoneWords: number[];
  /** Baris visual (indeks kata, urut kiri→kanan), urut atas→bawah — dasar teks tersensor. */
  rows: number[][];
}
