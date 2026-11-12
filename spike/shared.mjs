// SALINAN PERSIS dari src/ (src tidak bisa diimpor langsung karena bergantung pada firebase/ai).
// Jaga tetap sinkron:
//   EXTRACT_PROMPT          ← versi spike awal (sebelum optimasi 2026-11-10)
//   labExtractionJsonSchema ← src/lib/ai/schemas.ts (LAB_FLAGS/PII_KINDS)
//   EXTRACT_PROMPT_LEAN     ← src/lib/ai/router.ts (EXTRACT_PROMPT, dipakai app sejak optimasi)
//   labExtractionLeanJsonSchema / flagFromRange ← src/lib/ai/schemas.ts

export const LAB_FLAGS = ["low", "normal", "high", "critical", "unknown"];
export const PII_KINDS = ["name", "nik", "medical_record_number", "date_of_birth", "address", "phone", "other"];

export const EXTRACT_PROMPT =
  "Ekstrak semua baris hasil lab dari gambar ini ke JSON sesuai skema. " +
  "Jangan sertakan nama pasien, NIK, nomor rekam medis, tanggal lahir, alamat, atau telepon; " +
  "catat jenisnya di maskedPii dengan placeholder seperti [NAMA].";

// Varian Inggris (eksperimen bahasa prompt saja; makna sama).
export const EXTRACT_PROMPT_EN =
  "Extract every lab result row from this image into JSON matching the schema. " +
  "Do not include the patient's name, national ID (NIK), medical record number, date of birth, address, or phone; " +
  "record their kinds in maskedPii with placeholders such as [NAME].";

// --- Optimasi (salinan src/lib/ai/schemas.ts: EXTRACT_PROMPT_LEAN, labExtractionLeanJsonSchema, flagFromRange) ---
export const EXTRACT_PROMPT_LEAN =
  "Ekstrak semua baris hasil lab dari gambar ini ke JSON sesuai skema; tulis nama tes, nilai, satuan, " +
  "dan rentang rujukan persis seperti di gambar. Jangan tulis data identitas apa pun; " +
  "di piiKinds cukup sebut jenis data identitas pasien yang terlihat.";

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

function parseNum(s) {
  const t = String(s ?? "").trim().replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t.replace(",", "."));
  return t && Number.isFinite(n) ? n : null;
}

export function flagFromRange(value, range) {
  const v = parseNum(String(value ?? "").replace(/[<>≤≥]/g, ""));
  if (v === null) return "unknown";
  const r = String(range ?? "").trim();
  const m = r.match(/^(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)$/);
  if (m) {
    const lo = parseNum(m[1]);
    const hi = parseNum(m[2]);
    if (lo === null || hi === null) return "unknown";
    return v < lo ? "low" : v > hi ? "high" : "normal";
  }
  const c = r.match(/^([<>≤≥])\s*=?\s*(\d[\d.,]*)$/);
  if (c) {
    const lim = parseNum(c[2]);
    if (lim === null) return "unknown";
    if (c[1] === "<") return v < lim ? "normal" : "high";
    if (c[1] === "≤") return v <= lim ? "normal" : "high";
    if (c[1] === ">") return v > lim ? "normal" : "low";
    return v >= lim ? "normal" : "low";
  }
  return "unknown";
}

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
