import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCloudPayload,
  detectPii,
  EXPLAIN_PROMPTS,
  findPii,
  knownPiiFrom,
  type OcrPage,
  payloadPiiKinds,
  utf8Bytes,
} from "../pii";
import { ExplanationFormatError, matchExplanations, parseExplanation } from "./explanation";
import type { LabTestResult } from "./schemas";

const valid = {
  summary: "Most values are within range; hemoglobin is a little low.",
  perTest: [
    { testName: "Hemoglobin", explanation: "Hemoglobin carries oxygen. This value is slightly below the range." },
    { testName: "Leukosit", explanation: "White blood cells fight infection. This value is a bit high." },
  ],
  doctorQuestions: ["Q1?", "Q2?", "Q3?"],
  disclaimer: "Not a medical diagnosis.",
};

describe("parseExplanation", () => {
  it("valid JSON string → objek ter-trim", () => {
    const r = parseExplanation(JSON.stringify({ ...valid, summary: `  ${valid.summary}  ` }));
    expect(r.summary).toBe(valid.summary);
    expect(r.perTest).toHaveLength(2);
    expect(r.doctorQuestions).toEqual(["Q1?", "Q2?", "Q3?"]);
  });

  it("field wajib hilang / tipe salah → ExplanationFormatError", () => {
    for (const bad of [
      { ...valid, summary: undefined },
      { ...valid, perTest: undefined },
      { ...valid, perTest: [{ testName: "Hemoglobin" }] },
      { ...valid, doctorQuestions: "Q1?" },
      [],
      null,
    ]) {
      expect(() => parseExplanation(bad)).toThrow(ExplanationFormatError);
    }
    expect(() => parseExplanation("not json")).toThrow(/valid JSON/);
  });

  it("pertanyaan dokter: >6 dipotong ke 6, <3 ditolak, duplikat/kosong dibuang", () => {
    const many = parseExplanation({ ...valid, doctorQuestions: ["a", "b", "c", "d", "e", "f", "g", "h"] });
    expect(many.doctorQuestions).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(() => parseExplanation({ ...valid, doctorQuestions: ["a", "a", " ", "b"] })).toThrow(/at least 3/);
  });

  it("disclaimer opsional dari model (UI merender disclaimer tetap)", () => {
    expect(parseExplanation({ ...valid, disclaimer: undefined }).disclaimer).toBe("");
  });
});

describe("matchExplanations", () => {
  const row = (testName: string): LabTestResult => ({ testName, value: "1", unit: "", referenceRange: "", flag: "normal" });

  it("cocok via nama kanonik; baris tak dikenal → null; dipakai sekali", () => {
    const m = matchExplanations([row("Hb"), row("Siti R"), row("WBC"), row("Hemoglobin")], valid.perTest);
    expect(m.map((x) => x?.testName ?? null)).toEqual(["Hemoglobin", null, "Leukosit", null]);
  });

  it("tes ganda: baris yang di-drop allowlist tidak mencuri penjelasan baris terkirim", () => {
    const rs: LabTestResult[] = [
      { testName: "Hemoglobin", value: "lihat catatan", unit: "", referenceRange: "", flag: "unknown" }, // di-drop allowlist
      { testName: "Hemoglobin", value: "11.2", unit: "g/dL", referenceRange: "13.0-17.0", flag: "low" },
    ];
    const payload = buildCloudPayload(rs, undefined, "en");
    expect(payload.sentIndices).toEqual([1]);
    const m = matchExplanations(rs, valid.perTest, payload.sentIndices);
    expect(m[0]).toBeNull();
    expect(m[1]?.testName).toBe("Hemoglobin");
  });
});

describe("payload cloud per bahasa", () => {
  const page = JSON.parse(
    readFileSync(join(__dirname, "..", "pii", "__fixtures__", "a-id-hematologi.ocr.json"), "utf8"),
  ) as OcrPage;
  const truth = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "spike", "fixtures", "a-id-hematologi.truth.json"), "utf8")) as {
    results: { testName: string; value: string; unit: string; referenceRange: string; flag: string }[];
    pii: { kind: string; text: string }[];
  };
  const known = knownPiiFrom(page, detectPii(page));

  it("prompt template sendiri lolos guard pola", () => {
    for (const p of Object.values(EXPLAIN_PROMPTS)) expect(findPii(p)).toEqual([]);
  });

  it.each(["en", "id"] as const)("bahasa %s: lolos guard, tanpa PII dokumen, bytes = UTF-8 teks", (lang) => {
    const p = buildCloudPayload(truth.results, known, lang);
    expect(p.language).toBe(lang);
    expect(p.text.startsWith(EXPLAIN_PROMPTS[lang])).toBe(true);
    expect(payloadPiiKinds(p.text, known)).toEqual([]);
    for (const { text } of truth.pii) expect(p.text).not.toContain(text);
    expect(p.bytes).toBe(utf8Bytes(p.text));
    expect(p.bytes).toBe(Buffer.byteLength(p.text, "utf8"));
    expect(p.rows).toHaveLength(p.sentRows);
  });

  it("instruksi bahasa berbeda per enum; nilai di luar enum ditolak", () => {
    expect(EXPLAIN_PROMPTS.en).toContain("in English");
    expect(EXPLAIN_PROMPTS.id).toContain("in Indonesian");
    expect(() => buildCloudPayload(truth.results, known, "fr" as never)).toThrow(/Unsupported/);
  });

  it("baris di-drop membawa indeks + alasan tanpa teks dokumen", () => {
    const p = buildCloudPayload(
      [...truth.results, { testName: "Siti R", value: "1", unit: "%", referenceRange: "0-1", flag: "normal" }, { testName: "Hemoglobin", value: "Siti", unit: "g/dL", referenceRange: "", flag: "low" }],
      known,
      "en",
    );
    expect(p.dropped).toEqual([
      { index: truth.results.length, reason: "unknown_test" },
      { index: truth.results.length + 1, reason: "value_not_allowed" },
    ]);
    expect(JSON.stringify(p.dropped)).not.toContain("Siti");
  });
});
