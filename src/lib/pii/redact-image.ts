import type { OcrPage, PiiDetection } from "./types";

/** Minimal 2D context yang dipakai (CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D). */
export type RedactCtx = Pick<CanvasRenderingContext2D, "drawImage" | "fillRect" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "fill"> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
};

export interface RedactionShapes {
  /** [x, y, w, h] kotak hitam per span PII. */
  rects: [number, number, number, number][];
  /** Poligon hitam (zona kepala & kaki, miring mengikuti kemiringan halaman). */
  polys: [number, number][][];
}

const PAD = 3;

/** Jajaran genjang selebar halaman antara garis miring a dan b (y relatif garis miring, x = 0). */
const band = (W: number, slope: number, a: number, b: number): [number, number][] => [
  [0, a],
  [W, a + slope * W],
  [W, b + slope * W],
  [0, b],
];

/**
 * Geometri redaksi (murni, teruji tanpa canvas): kotak tiap span PII, zona kepala laporan kecuali pita judul generik,
 * dan zona kaki laporan sampai bawah halaman. Koordinat = ruang koordinat `page` (gambar yang di-OCR).
 */
export function redactionShapes(page: OcrPage, det: PiiDetection): RedactionShapes {
  const W = page.width;
  const H = page.height;
  const rects = det.spans.map(
    (s) => [s.bbox.x0 - PAD, s.bbox.y0 - PAD, s.bbox.x1 - s.bbox.x0 + 2 * PAD, s.bbox.y1 - s.bbox.y0 + 2 * PAD] as [number, number, number, number],
  );
  const polys: [number, number][][] = [];
  const z = det.zone;
  if (z) {
    // Interval y dari jauh di atas halaman sampai batas zona, dikurangi pita judul generik.
    const bands = [...z.keepBands].sort((a, b) => a.top - b.top);
    let from = -H - Math.abs(z.slope) * W;
    for (const b of bands) {
      if (b.top > from) polys.push(band(W, z.slope, from, Math.min(b.top, z.y0)));
      from = Math.max(from, b.bottom);
    }
    if (from < z.y0) polys.push(band(W, z.slope, from, z.y0));
  }
  const f = det.footer;
  if (f) polys.push(band(W, f.slope, f.y0, 2 * H + Math.abs(f.slope) * W));
  return { rects, polys };
}

/** Gambar `image` lalu tutup dengan bentuk dari `redactionShapes`. */
export function drawRedacted(ctx: RedactCtx, image: CanvasImageSource, page: OcrPage, det: PiiDetection): void {
  ctx.drawImage(image, 0, 0, page.width, page.height);
  ctx.fillStyle = "#000";
  const { rects, polys } = redactionShapes(page, det);
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
  for (const poly of polys) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Render gambar tersensor ke Blob PNG (hanya di memori; untuk pratinjau lokal).
 * Ukuran gambar harus sama dengan ruang koordinat `page` — bila tidak, bbox tidak sejajar → tolak (fail-closed).
 */
export async function redactedImageBlob(image: ImageBitmap, page: OcrPage, det: PiiDetection): Promise<Blob> {
  if (image.width !== page.width || image.height !== page.height) {
    throw new Error(`Ukuran gambar ${image.width}×${image.height} ≠ ruang koordinat OCR ${page.width}×${page.height} — redaksi dibatalkan`);
  }
  const canvas = new OffscreenCanvas(page.width, page.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia untuk redaksi gambar");
  drawRedacted(ctx, image, page, det);
  return canvas.convertToBlob({ type: "image/png" });
}
