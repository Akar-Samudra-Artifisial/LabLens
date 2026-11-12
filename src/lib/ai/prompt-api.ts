"use client";

/**
 * Akses langsung Chrome Prompt API (Gemini Nano) untuk ekstraksi on-device.
 *
 * Kenapa tidak lewat SDK hybrid (@firebase/ai 3.0.0, ChromeAdapterImpl):
 * - `generateContent` selalu `LanguageModel.create()` sesi baru per panggilan dan
 *   `getGenerativeModel` per klik membuat adapter baru → model bisa ter-unload, create cold ±13–16 s.
 * - Tidak ada `signal` per-request untuk on-device → tidak bisa timeout/batal (run degeneratif ±6 menit).
 * Di sini: satu sesi dasar dibuat sekali (warm-up), tiap request memakai `clone()` + AbortSignal + streaming.
 */

export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelSession {
  promptStreaming(
    input: unknown,
    options?: { responseConstraint?: object; signal?: AbortSignal },
  ): ReadableStream<string>;
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(options?: object): Promise<Availability>;
  create(options?: object): Promise<LanguageModelSession>;
}

export const ON_DEVICE_CREATE_OPTIONS = {
  expectedInputs: [{ type: "text" }, { type: "image" }],
  expectedOutputs: [{ type: "text" }],
};

export function promptApi(): LanguageModelStatic | undefined {
  return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

let baseSession: Promise<LanguageModelSession> | null = null;

/**
 * Buat (sekali) sesi dasar agar model termuat sebelum klik pertama.
 * Saat status "downloadable", create() butuh user activation → panggil dari handler klik.
 */
export function warmUpOnDevice(): Promise<LanguageModelSession> {
  const api = promptApi();
  if (!api) return Promise.reject(new Error("Prompt API tidak ada — perlu Chrome Desktop 139+"));
  baseSession ??= api.create(ON_DEVICE_CREATE_OPTIONS).catch((e: unknown) => {
    baseSession = null;
    throw e;
  });
  return baseSession;
}

export async function openOnDeviceSession(signal: AbortSignal): Promise<LanguageModelSession> {
  const base = await warmUpOnDevice();
  return base.clone({ signal });
}

/** Perkecil gambar (sisi panjang ≤ maxSide) langsung ke ImageBitmap — Prompt API menerima bitmap, tanpa re-encode. */
export async function fileToBitmap(file: Blob, maxSide = 1024): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxSide) return bitmap;
  const scale = maxSide / longest;
  const resizeWidth = Math.round(bitmap.width * scale);
  const resizeHeight = Math.round(bitmap.height * scale);
  bitmap.close();
  return createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: "high" });
}
