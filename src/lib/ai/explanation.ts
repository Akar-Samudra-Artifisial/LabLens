// Path relatif (bukan alias "@/"): modul ini juga dimuat vitest tanpa resolver alias.
import { canonicalTestName } from "../pii/allowlist";
import type { ExplanationResult, LabTestResult, TestExplanation } from "./schemas";

// Duplikat nilai DOCTOR_QUESTIONS (schemas.ts) agar modul ini bebas dari import firebase (dipakai test node).
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 6;
const MAX_PER_TEST = 60;
const MAX_LEN = { summary: 1200, explanation: 600, question: 300, disclaimer: 400, testName: 80 } as const;

/** Respons cloud tidak sesuai kontrak ExplanationResult — pesan aman ditampilkan ke pengguna. */
export class ExplanationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplanationFormatError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function requiredText(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "") throw new ExplanationFormatError(`Cloud explanation is missing "${field}".`);
  return v.trim().slice(0, max);
}

/**
 * Parse + validasi runtime output cloud. Bentuk salah → ExplanationFormatError (bukan crash UI).
 * String dipangkas & dibatasi panjangnya; doctorQuestions harus ≥3 dan dipotong ke maks. 6.
 */
export function parseExplanation(raw: unknown): ExplanationResult {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ExplanationFormatError("Cloud explanation is not valid JSON.");
    }
  }
  if (!isObject(data)) throw new ExplanationFormatError("Cloud explanation has an unexpected shape.");

  const summary = requiredText(data.summary, "summary", MAX_LEN.summary);

  if (!Array.isArray(data.perTest)) throw new ExplanationFormatError('Cloud explanation is missing "perTest".');
  const perTest: TestExplanation[] = data.perTest.slice(0, MAX_PER_TEST).map((t, i) => {
    if (!isObject(t)) throw new ExplanationFormatError(`Cloud explanation has an invalid "perTest[${i}]".`);
    return {
      testName: requiredText(t.testName, `perTest[${i}].testName`, MAX_LEN.testName),
      explanation: requiredText(t.explanation, `perTest[${i}].explanation`, MAX_LEN.explanation),
    };
  });

  if (!Array.isArray(data.doctorQuestions)) throw new ExplanationFormatError('Cloud explanation is missing "doctorQuestions".');
  const questions = [
    ...new Set(
      data.doctorQuestions
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .map((q) => q.trim().slice(0, MAX_LEN.question)),
    ),
  ];
  if (questions.length < MIN_QUESTIONS) {
    throw new ExplanationFormatError(`Expected at least ${MIN_QUESTIONS} doctor questions, got ${questions.length}.`);
  }

  const disclaimer = typeof data.disclaimer === "string" ? data.disclaimer.trim().slice(0, MAX_LEN.disclaimer) : "";
  return { summary, perTest, doctorQuestions: questions.slice(0, MAX_QUESTIONS), disclaimer };
}

/**
 * Pasangkan penjelasan model ke baris lokal lewat nama kanonik (kamus allowlist). Satu penjelasan dipakai sekali
 * (tes ganda dipasangkan berurutan). Hanya baris di `sentIndices` (yang benar-benar dikirim) yang bisa dipasangkan —
 * baris yang di-drop allowlist tidak "mencuri" penjelasan milik baris terkirim bernama sama. Lainnya → null.
 */
export function matchExplanations(
  rows: readonly LabTestResult[],
  perTest: readonly TestExplanation[],
  sentIndices?: readonly number[],
): (TestExplanation | null)[] {
  const pool = perTest.map((t) => ({ t, canon: canonicalTestName(t.testName), used: false }));
  const sent = sentIndices ? new Set(sentIndices) : null;
  return rows.map((r, i) => {
    if (sent && !sent.has(i)) return null;
    const canon = canonicalTestName(r.testName);
    if (!canon) return null;
    const hit = pool.find((p) => !p.used && p.canon === canon);
    if (!hit) return null;
    hit.used = true;
    return hit.t;
  });
}

/** Baris lokal berflag critical (flag dihitung di perangkat) — sumber banner tenaga medis. */
export const criticalRows = (rows: readonly LabTestResult[]) => rows.filter((r) => r.flag === "critical");

/** Disclaimer tetap — dirender UI, tidak bergantung pada teks model. */
export const DISCLAIMER = {
  en: "Not a medical diagnosis. LabLens explains your numbers in plain language; only a qualified health professional can interpret your results.",
  id: "Bukan diagnosis medis. LabLens menjelaskan angka hasil lab dengan bahasa awam; hanya tenaga kesehatan yang dapat menafsirkan hasil Anda.",
} as const;
