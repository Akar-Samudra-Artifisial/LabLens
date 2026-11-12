"use client";

import {
  type GenerativeModel,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import { getFirebaseApp } from "@/lib/firebase";
import { ON_DEVICE_CREATE_OPTIONS } from "./prompt-api";
import { explanationResultSchema, labExtractionCloudSchema, labExtractionLeanJsonSchema } from "./schemas";

// Default model cloud untuk hybrid di SDK (@firebase/ai 3.0.0): gemini-3.5-flash-lite.
const CLOUD_MODEL = process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite";

function ai() {
  return getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
}

let extractionModel: GenerativeModel | null = null;

/**
 * Model ekstraksi on-device (Gemini Nano via Firebase AI Logic hybrid).
 * Selalu ONLY_ON_DEVICE: gambar mentah berisi PII tidak boleh jatuh ke cloud.
 * Instance di-cache: adapter Chrome milik SDK menahan sesi terakhir sehingga model tetap termuat antar-ekstraksi.
 */
export function getOnDeviceExtractionModel(): GenerativeModel {
  extractionModel ??= getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: ON_DEVICE_CREATE_OPTIONS,
      promptOptions: { responseConstraint: labExtractionLeanJsonSchema },
    },
  });
  return extractionModel;
}

let warmUp: Promise<void> | null = null;

/**
 * Muat Gemini Nano lebih awal lewat SDK (create cold ±12–16 s): unduh bila perlu (`initializeDeviceModel`),
 * lalu satu prompt teks pendek ONLY_ON_DEVICE. Tanpa responseConstraint agar output tetap pendek.
 */
export function warmUpOnDeviceModel(): Promise<void> {
  warmUp ??= (async () => {
    const model = getGenerativeModel(ai(), {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: ON_DEVICE_CREATE_OPTIONS },
    });
    await model.initializeDeviceModel();
    await model.generateContent("Balas hanya: ok");
  })().catch((e: unknown) => {
    warmUp = null;
    throw e;
  });
  return warmUp;
}

export const CLOUD_EXPLAIN_MODEL = CLOUD_MODEL;
export const CLOUD_EXTRACT_MODEL = CLOUD_MODEL;

/**
 * Fallback ekstraksi cloud saat Gemini Nano tidak tersedia: HANYA menerima teks OCR termasking (buildFallbackText),
 * tidak pernah gambar. Output JSON terstruktur (labExtractionCloudSchema).
 */
export function getCloudExtractionModel(): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: "application/json", responseSchema: labExtractionCloudSchema },
    },
  });
}

/** Model penjelasan cloud — hanya menerima data yang sudah dianonimkan; output JSON terstruktur (ExplanationResult). */
export function getCloudExplainModel(): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: "application/json", responseSchema: explanationResultSchema },
    },
  });
}
