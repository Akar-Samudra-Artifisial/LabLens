import type { OcrLine, OcrPage, OcrWord } from "../pii/types";

// Bentuk minimal output tesseract.js (`recognize(..., { blocks: true })`) yang dipakai.
// Ditulis ulang (bukan import tipe tesseract.js) agar file ini juga bisa dijalankan Node apa adanya
// oleh scripts/ocr-fixtures.mjs.
interface TBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TPage {
  blocks: { paragraphs: { lines: { bbox: TBbox; baseline: TBbox; words: { text: string; bbox: TBbox; confidence: number }[] }[] }[] }[] | null;
}

const box = (b: TBbox) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });

/**
 * Parameter OCR yang dipakai app dan scripts/ocr-fixtures.mjs (diukur di 3 fixture spike):
 * PSM 3 (auto) membaca tabel berbingkai (fixture a) jauh lebih baik dari PSM 6 (default tesseract.js);
 * PSM 6 lebih baik untuk foto buram (fixture c) → dipakai sebagai pass kedua bila kualitas pass pertama rendah.
 * rotateAuto meluruskan foto miring; bbox lalu relatif terhadap gambar yang diputar (output imageColor).
 */
export const OCR_PASSES = ["3", "6"] as const;
/** Pass kedua dijalankan bila jumlah karakter kata berkepercayaan tinggi di bawah ini. */
export const OCR_MIN_GOOD_CHARS = 250;

/** Jumlah karakter dari kata berkepercayaan ≥70 dan ≥2 alfanumerik — proksi kualitas OCR. */
export function ocrQuality(page: OcrPage): number {
  return page.words.filter((w) => w.conf >= 70 && /[A-Za-z0-9]{2}/.test(w.text)).reduce((s, w) => s + w.text.length, 0);
}

/**
 * Semua bbox kata berada di dalam gambar (toleransi `tol` px). false = bbox dan gambar tidak sejajar
 * (mis. bbox relatif ke gambar yang diputar tesseract, tapi gambar yang disensor belum diputar) → jangan dipakai.
 */
export function bboxesFit(page: OcrPage, tol = 4): boolean {
  return page.words.every(
    ({ bbox: b }) => b.x0 >= -tol && b.y0 >= -tol && b.x1 <= page.width + tol && b.y1 <= page.height + tol && b.x0 <= b.x1 && b.y0 <= b.y1,
  );
}

/** Ratakan blok → paragraf → baris → kata tesseract menjadi OcrPage. */
export function toOcrPage(data: TPage, width: number, height: number): OcrPage {
  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const line = lines.length;
        lines.push({ bbox: box(l.bbox), baseline: box(l.baseline) });
        for (const w of l.words) {
          if (!w.text.trim()) continue;
          words.push({ text: w.text, bbox: box(w.bbox), conf: Math.round(w.confidence), line });
        }
      }
  return { width, height, words, lines };
}
