"use client";

import {
  type GenerativeModel,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import { getFirebaseApp } from "@/lib/firebase";
import { labExtractionJsonSchema } from "./schemas";

// Default model cloud untuk hybrid di SDK (@firebase/ai 3.0.0): gemini-3.5-flash-lite.
const CLOUD_MODEL = process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite";

function ai() {
  return getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
}

/** Model ekstraksi on-device (Gemini Nano via Chrome Prompt API). */
export function getOnDeviceExtractionModel(strict = true): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: strict ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text" }, { type: "image" }],
        expectedOutputs: [{ type: "text" }],
      },
      promptOptions: { responseConstraint: labExtractionJsonSchema },
    },
  });
}

/** Model penjelasan cloud — hanya menerima data yang sudah dianonimkan. */
export function getCloudExplainModel(): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL },
  });
}
