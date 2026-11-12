import { Schema } from "firebase/ai";

export const LAB_FLAGS = ["low", "normal", "high", "critical", "unknown"] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

export const PII_KINDS = [
  "name",
  "nik",
  "medical_record_number",
  "date_of_birth",
  "address",
  "phone",
  "other",
] as const;
export type PiiKind = (typeof PII_KINDS)[number];

export interface LabTestResult {
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: LabFlag;
}

export interface MaskedPii {
  kind: PiiKind;
  placeholder: string;
}

export interface LabExtraction {
  results: LabTestResult[];
  maskedPii: MaskedPii[];
}

/**
 * Skema untuk cloud (generationConfig.responseSchema).
 * Di SDK, responseSchema tidak diteruskan ke on-device; on-device memakai
 * onDeviceParams.promptOptions.responseConstraint (JSON Schema biasa) di bawah.
 */
export const labExtractionSchema = Schema.object({
  properties: {
    results: Schema.array({
      items: Schema.object({
        properties: {
          testName: Schema.string(),
          value: Schema.string(),
          unit: Schema.string(),
          referenceRange: Schema.string(),
          flag: Schema.enumString({ enum: [...LAB_FLAGS] }),
        },
      }),
    }),
    maskedPii: Schema.array({
      items: Schema.object({
        properties: {
          kind: Schema.enumString({ enum: [...PII_KINDS] }),
          placeholder: Schema.string(),
        },
      }),
    }),
  },
});

/**
 * Skema output on-device yang dipakai `extractOnDevice` (Prompt API langsung).
 * Lebih ramping dari labExtractionJsonSchema: tanpa `flag` (dihitung deterministik, lihat flagFromRange)
 * dan tanpa teks `placeholder` (model menyalin PII asli ke sana — spike/RESULTS.md); hanya jenis PII.
 * Hasilnya dipetakan ke LabExtraction, jadi kontrak ke cloud/UI tidak berubah.
 */
export interface LabExtractionLean {
  results: Omit<LabTestResult, "flag">[];
  piiKinds: PiiKind[];
}

export const labExtractionLeanJsonSchema = {
  type: "object",
  required: ["results", "piiKinds"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["testName", "value", "unit", "referenceRange"],
        properties: {
          testName: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          referenceRange: { type: "string" },
        },
      },
    },
    piiKinds: { type: "array", items: { type: "string", enum: [...PII_KINDS] } },
  },
};

/** Bahasa output penjelasan — satu sumber kebenaran di pii/cloud-payload.ts (enum tetap, bukan teks bebas). */
export { PAYLOAD_LANGUAGES as EXPLAIN_LANGUAGES, type PayloadLanguage as ExplainLanguage } from "../pii/cloud-payload";

export const DOCTOR_QUESTIONS = { min: 3, max: 6 } as const;

export interface TestExplanation {
  /** Nama kanonik yang dikirim di payload (dicocokkan ulang ke baris lokal lewat canonicalTestName). */
  testName: string;
  explanation: string;
}

/**
 * Output penjelasan cloud. Flag sengaja TIDAK ada di sini: UI memakai flag lokal (flagFromRange), model hanya teks.
 * `disclaimer` diminta dari model tetapi UI selalu merender disclaimer tetap sendiri.
 */
export interface ExplanationResult {
  summary: string;
  perTest: TestExplanation[];
  doctorQuestions: string[];
  disclaimer: string;
}

/** Skema cloud (generationConfig.responseSchema) untuk ExplanationResult. */
export const explanationResultSchema = Schema.object({
  properties: {
    summary: Schema.string({ description: "2-3 plain-language sentences about the overall picture, no diagnosis." }),
    perTest: Schema.array({
      items: Schema.object({
        properties: {
          testName: Schema.string({ description: "Exactly the testName from the input row." }),
          explanation: Schema.string({ description: "1-2 plain-language sentences: what it measures and what this value means." }),
        },
      }),
    }),
    doctorQuestions: Schema.array({
      items: Schema.string(),
      minItems: DOCTOR_QUESTIONS.min,
      maxItems: DOCTOR_QUESTIONS.max,
    }),
    disclaimer: Schema.string(),
  },
});

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  name: "[NAMA]",
  nik: "[NIK]",
  medical_record_number: "[NO_RM]",
  date_of_birth: "[TGL_LAHIR]",
  address: "[ALAMAT]",
  phone: "[TELEPON]",
  other: "[LAINNYA]",
};

// "13.800" / "13,800" → 13800 ; "10.2" / "10,2" → 10.2 (format angka lab Indonesia)
function parseLabNumber(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Flag deterministik dari nilai vs rentang rujukan ("a - b", "<x", ">x", "≤x", "≥x"); selain itu "unknown". */
export function flagFromRange(value: string, range: string): LabFlag {
  const v = parseLabNumber(value.replace(/[<>≤≥]/g, ""));
  if (v === null) return "unknown";
  const r = range.trim();
  const between = r.match(/^(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)$/);
  if (between) {
    const lo = parseLabNumber(between[1]);
    const hi = parseLabNumber(between[2]);
    if (lo === null || hi === null) return "unknown";
    return v < lo ? "low" : v > hi ? "high" : "normal";
  }
  const bound = r.match(/^([<>≤≥])\s*=?\s*(\d[\d.,]*)$/);
  if (bound) {
    const lim = parseLabNumber(bound[2]);
    if (lim === null) return "unknown";
    switch (bound[1]) {
      case "<":
        return v < lim ? "normal" : "high";
      case "≤":
        return v <= lim ? "normal" : "high";
      case ">":
        return v > lim ? "normal" : "low";
      default:
        return v >= lim ? "normal" : "low";
    }
  }
  return "unknown";
}

/**
 * Skema cloud untuk fallback ekstraksi dari teks OCR termasking (tanpa gambar). Hanya 4 field per baris:
 * flag dihitung lokal (flagFromRange) dan jenis PII dari aturan lokal (mergeMaskedPii), bukan dari model.
 */
export const labExtractionCloudSchema = Schema.object({
  properties: {
    results: Schema.array({
      items: Schema.object({
        properties: {
          testName: Schema.string(),
          value: Schema.string(),
          unit: Schema.string(),
          referenceRange: Schema.string(),
        },
      }),
    }),
  },
});

/** Petakan output lean on-device ke kontrak LabExtraction. */
export function fromLeanExtraction(lean: LabExtractionLean): LabExtraction {
  const kinds = [...new Set(lean.piiKinds ?? [])].filter((k): k is PiiKind => PII_KINDS.includes(k));
  return {
    results: (lean.results ?? []).map((r) => ({ ...r, flag: flagFromRange(r.value, r.referenceRange) })),
    maskedPii: kinds.map((kind) => ({ kind, placeholder: PII_PLACEHOLDERS[kind] })),
  };
}

/** JSON Schema untuk Prompt API Chrome (responseConstraint) — padanan labExtractionSchema. */
export const labExtractionJsonSchema = {
  type: "object",
  required: ["results", "maskedPii"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["testName", "value", "unit", "referenceRange", "flag"],
        properties: {
          testName: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          referenceRange: { type: "string" },
          flag: { type: "string", enum: [...LAB_FLAGS] },
        },
      },
    },
    maskedPii: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "placeholder"],
        properties: {
          kind: { type: "string", enum: [...PII_KINDS] },
          placeholder: { type: "string" },
        },
      },
    },
  },
};
