"use client";

import type { Worker } from "tesseract.js";
import type { OcrPage } from "../pii/types";
import { bboxesFit, OCR_MIN_GOOD_CHARS, OCR_PASSES, ocrQuality, toOcrPage } from "./from-tesseract";

/**
 * OCR lokal deterministik: tesseract.js (WASM) di Web Worker, bahasa ind+eng.
 * Semua aset (worker, core WASM, traineddata) dari /public/tesseract — `pnpm ocr:assets` — tanpa CDN.
 */

/** Gambar lebih besar dari ini diperkecil sebelum OCR (foto HP 4000 px → ±2 s lebih cepat, akurasi cukup). */
const OCR_MAX_SIDE = 2000;

let workerP: Promise<Worker> | null = null;

function assetUrl(path: string): string {
  return new URL(`/tesseract/${path}`, window.location.origin).href;
}

/** Siapkan worker sekali (muat WASM + traineddata ±1 s) — panggil saat halaman dimuat. */
export function warmUpOcr(): Promise<Worker> {
  workerP ??= import("tesseract.js")
    .then(({ createWorker }) =>
      createWorker(["ind", "eng"], 1, {
        workerPath: assetUrl("worker.min.js"),
        corePath: assetUrl("core"),
        langPath: assetUrl("lang"),
        gzip: true,
        // Worker langsung dari /tesseract/worker.min.js (bukan blob: URL) → CSP cukup worker-src 'self'.
        workerBlobURL: false,
      }),
    )
    .catch((e: unknown) => {
      workerP = null;
      throw e;
    });
  return workerP;
}

export interface OcrResult {
  page: OcrPage;
  /** Gambar dalam ruang koordinat bbox `page` (sudah diluruskan bila rotateAuto memutar). */
  image: ImageBitmap;
  ms: number;
  psm: string;
  rotateRadians: number;
}

async function scaledInput(file: Blob): Promise<{ input: Blob; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= OCR_MAX_SIDE) return { input: file, bitmap };
  const scale = OCR_MAX_SIDE / longest;
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const input = await canvas.convertToBlob({ type: "image/png" });
  return { input, bitmap: await createImageBitmap(input) };
}

/**
 * OCR satu gambar. Pass 1 PSM 3 (auto); bila kualitas rendah, pass 2 PSM 6 dan pilih yang lebih baik
 * (lihat OCR_PASSES). Batal → worker dihentikan (tesseract tidak bisa membatalkan job) dan dibuat ulang nanti.
 */
export async function runOcr(file: Blob, signal?: AbortSignal): Promise<OcrResult> {
  const t0 = performance.now();
  signal?.throwIfAborted();
  // Promise yang reject saat dibatalkan: dipakai di Promise.race karena worker.recognize() tidak bisa dibatalkan
  // dan tidak pernah selesai setelah worker di-terminate.
  const warm = warmUpOcr();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      // Worker dihentikan (job berjalan ikut mati) dan dibuat ulang pada pemanggilan berikutnya.
      if (workerP === warm) workerP = null;
      warm.then((w) => w.terminate()).catch(() => {});
      reject(signal?.reason ?? new DOMException("Dibatalkan", "AbortError"));
    };
  });
  aborted.catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const race = <T>(p: Promise<T>) => Promise.race([p, aborted]);
  const owned: ImageBitmap[] = [];
  let result: ImageBitmap | null = null;
  try {
    const worker = await race(warm);
    const { input, bitmap } = await race(scaledInput(file));
    owned.push(bitmap);
    let best: { page: OcrPage; q: number; psm: string; rotateRadians: number; imageColor: string | null } | null = null;
    for (const psm of OCR_PASSES) {
      signal?.throwIfAborted();
      // tesseract_pageseg_mode bertipe enum PSM ("3", "6", …) di d.ts; nilainya string yang sama.
      await race(worker.setParameters({ tessedit_pageseg_mode: psm as never }));
      const { data } = await race(worker.recognize(input, { rotateAuto: true }, { blocks: true, imageColor: true }));
      const page = toOcrPage(data as Parameters<typeof toOcrPage>[0], bitmap.width, bitmap.height);
      const q = ocrQuality(page);
      if (!best || q > best.q) best = { page, q, psm, rotateRadians: data.rotateRadians ?? 0, imageColor: data.imageColor };
      if (q >= OCR_MIN_GOOD_CHARS) break;
    }
    signal?.throwIfAborted();
    if (!best) throw new Error("OCR tidak menghasilkan apa pun");
    let image = bitmap;
    // Bila tesseract memutar gambar, bbox relatif ke gambar yang diputar → wajib pakai gambar itu untuk redaksi.
    if (best.rotateRadians !== 0) {
      if (!best.imageColor) throw new Error("OCR memutar gambar tetapi tidak mengembalikan gambar hasil putaran — redaksi tidak bisa disejajarkan");
      const [head, b64] = best.imageColor.split(",", 2);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      image = await race(createImageBitmap(new Blob([bytes], { type: head.match(/^data:([^;]+)/)?.[1] ?? "image/png" })));
      owned.push(image);
    }
    const page: OcrPage = { ...best.page, width: image.width, height: image.height };
    if (!bboxesFit(page)) throw new Error("Posisi teks OCR di luar gambar — redaksi tidak bisa disejajarkan");
    result = image;
    return { page, image, ms: Math.round(performance.now() - t0), psm: best.psm, rotateRadians: best.rotateRadians };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Bitmap yang tidak dikembalikan (atau semua, bila gagal/batal) ditutup di sini; yang dikembalikan ditutup pemanggil.
    for (const b of owned) if (b !== result) b.close();
  }
}

