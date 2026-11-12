"use client";

/**
 * Helper on-device yang BUKAN inference: cek status ketersediaan Chrome Prompt API (untuk UI)
 * dan persiapan gambar. Semua inference lewat Firebase AI Logic (lihat models.ts / router.ts).
 */

export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelStatic {
  availability(options?: object): Promise<Availability>;
}

export const ON_DEVICE_CREATE_OPTIONS = {
  expectedInputs: [{ type: "text" as const }, { type: "image" as const }],
  expectedOutputs: [{ type: "text" as const }],
};

/** Hanya untuk `availability()` (status UI) — jangan dipakai untuk inference. */
export function promptApi(): LanguageModelStatic | undefined {
  return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Gambar → `inlineData` (base64) untuk SDK, sisi panjang ≤ maxSide.
 * Gambar yang sudah kecil dikirim apa adanya; yang besar diperkecil lalu di-encode ulang dengan tipe yang sama.
 */
export async function fileToInlineData(
  file: Blob,
  maxSide = 1024,
): Promise<{ mimeType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSide) {
      return { mimeType: file.type, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
    }
    const scale = maxSide / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D tidak tersedia untuk memperkecil gambar");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: file.type, quality: 0.92 });
    return { mimeType: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
  } finally {
    bitmap.close();
  }
}
