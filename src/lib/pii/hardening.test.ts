import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bboxesFit } from "../ocr/from-tesseract";
import {
  allowRange,
  allowUnit,
  allowValue,
  buildCloudPayload,
  canonicalTestName,
  crossRowPii,
  detectPii,
  MAX_CLOUD_ROWS,
  plausibleNik,
  EXPLAIN_PROMPT,
  findPii,
  knownPiiFrom,
  type OcrPage,
  type PiiDetection,
  PiiLeakError,
  redactText,
  sanitizeForCloud,
} from "./index";
import { redactionShapes } from "./redact-image";

// Fixture: teks OCR nyata di __fixtures__ + ground truth dari spike/fixtures (satu sumber kebenaran yang sama
// dipakai runner spike, agar skor test & skor latensi tidak bisa menyimpang).
const ROOT = join(__dirname, "..", "..", "..");
const loadPage = (name: string): OcrPage => JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${name}.ocr.json`), "utf8"));
const loadTruth = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, "spike", "fixtures", `${name}.truth.json`), "utf8")) as {
    results: { testName: string; value: string; unit: string; referenceRange: string; flag: string }[];
    pii: { kind: string; text: string }[];
  };

/** Halaman OCR palsu: 1 karakter = 10 px, baris setinggi 20 px; ≥4 spasi = pindah kolom (+100 px). */
function pageFromLines(lines: string[]): OcrPage {
  const page: OcrPage = { width: 2000, height: lines.length * 30 + 20, words: [], lines: [] };
  lines.forEach((line, li) => {
    const y0 = 10 + li * 30;
    let x = 10;
    page.lines.push({ bbox: { x0: 10, y0, x1: 10 + line.length * 10, y1: y0 + 20 }, baseline: { x0: 10, y0: y0 + 18, x1: 1000, y1: y0 + 18 } });
    for (const part of line.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        x += part.length >= 4 ? 100 : part.length * 10;
        continue;
      }
      page.words.push({ text: part, conf: 95, line: li, bbox: { x0: x, y0, x1: x + part.length * 10, y1: y0 + 20 } });
      x += part.length * 10;
    }
  });
  return page;
}

describe("allowlist payload cloud (#1)", () => {
  it("nama tes fixture a & b dipetakan ke nama kanonik kamus", () => {
    for (const f of ["a-id-hematologi", "b-us-lipid"]) {
      const names = loadTruth(f).results.map((r) => canonicalTestName(r.testName));
      expect(names).not.toContain(null);
    }
    expect(canonicalTestName("Cholesterol, Total")).toBe("Kolesterol Total");
    expect(canonicalTestName("LDL Cholesterol (calc)")).toBe("Kolesterol LDL");
    expect(canonicalTestName("Hemoglobin Alc")).toBe("HbA1c"); // salah baca OCR
    expect(canonicalTestName("Hb")).toBe("Hemoglobin");
    expect(canonicalTestName("Glucose, Fasting")).toBe("Glukosa Puasa");
  });

  it("nama tidak dikenal / berisi nama orang → baris tidak dikirim", () => {
    for (const n of ["Siti Rahmawati", "Hemoglobin Siti", "Catatan: Siti R.", "Andi", "dr. Andi Wijaya", "x".repeat(200)]) {
      expect(canonicalTestName(n)).toBeNull();
    }
    const { rows, dropped } = sanitizeForCloud([
      { testName: "Hemoglobin", value: "10.2", unit: "g/dL", referenceRange: "12.0 - 16.0", flag: "low" },
      { testName: "Siti Rahmawati Putri", value: "1", unit: "%", referenceRange: "0 - 1", flag: "normal" },
    ]);
    expect(rows).toEqual([{ testName: "Hemoglobin", value: "10.2", unit: "g/dL", referenceRange: "12.0 - 16.0", flag: "low" }]);
    expect(dropped).toBe(1);
  });

  it("value: angka/kualifier saja; teks lain, telepon, NIK ditolak", () => {
    expect(["10.2", "13.800", "452.000", "<5.7", "≥ 60", "+2", "Negatif", "+++", "0"].map((v) => allowValue(v))).not.toContain(null);
    for (const v of ["Siti", "0812-3456-7890", "3273015408910002", "081234567890", "10.2 Siti", "1".repeat(17), ""]) expect(allowValue(v)).toBeNull();
  });

  it("unit & rentang: di luar allowlist dikosongkan; panjang maksimum", () => {
    expect(["g/dL", "/µL", "juta/µL", "%", "mm/jam", "mg/dL", "fL", "pg"].map(allowUnit)).not.toContain("");
    expect(allowUnit("Siti")).toBe("");
    expect(allowUnit("g/dL Siti")).toBe("");
    expect(allowRange("150.000 - 400.000")).toBe("150.000 - 400.000");
    expect(allowRange("<200")).toBe("<200");
    expect(allowRange("70 s/d 99")).toBe("70 s/d 99");
    expect(allowRange("Siti 12-16")).toBe("");
    expect(allowRange("3273.0154.0891.0002")).toBe("");
    expect(allowRange(`1 - ${"1".repeat(40)}`)).toBe("");
  });

  it("payload final: hanya field allowlist, lolos guard, tanpa token PII dokumen (fixture a + output Nano jahil)", () => {
    const page = loadPage("a-id-hematologi");
    const known = knownPiiFrom(page, detectPii(page));
    const truth = loadTruth("a-id-hematologi");
    const nano = [
      ...truth.results,
      { testName: "Hemoglobin", value: "Siti", unit: "g/dL", referenceRange: "12-16", flag: "low" },
      { testName: "Leukosit", value: "13.800", unit: "Rahmawati", referenceRange: "Putri 4-10", flag: "high", extra: "3273015408910002" },
      { testName: "Siti R", value: "1", unit: "%", referenceRange: "0-1", flag: "normal" },
    ];
    const p = buildCloudPayload(nano, known);
    expect(p.sentRows).toBe(truth.results.length + 1);
    expect(p.droppedRows).toBe(2);
    expect(p.text.startsWith(EXPLAIN_PROMPT)).toBe(true);
    const rows = JSON.parse(p.text.slice(EXPLAIN_PROMPT.length)) as Record<string, string>[];
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["flag", "referenceRange", "testName", "unit", "value"]);
    for (const tok of ["Siti", "Rahmawati", "Putri", "3273015408910002", "extra"]) expect(p.text).not.toContain(tok);
  });

  it("tidak ada baris lolos → Error, bukan payload kosong", () => {
    expect(() => buildCloudPayload([{ testName: "Siti", value: "x", unit: "", referenceRange: "", flag: "low" }])).toThrow(/allowlist/);
  });
});

describe("putaran 2: batas digit & PII terpecah (PoC security-reviewer)", () => {
  const row = (value: string, referenceRange = "", unit = "g/dL", testName = "Hemoglobin") => ({ testName, value, unit, referenceRange, flag: "normal" });

  it("#1 referenceRange: NIK 16 digit dipecah jadi rentang ditolak; batas per sisi & total digit", () => {
    expect(allowRange("3273051-4089100.02")).toBe("");
    expect(allowRange("327305 - 1408910")).toBe("");
    expect(allowRange("12345.678 - 99999.999")).toBe(""); // 16 digit total
    expect(allowRange("1.0001 - 2")).toBe(""); // desimal 4 digit
    expect(allowRange("150.000 - 400.000")).toBe("150.000 - 400.000");
    expect(allowRange("4.000 - 10.000")).toBe("4.000 - 10.000");
    expect(allowRange("0812 - 3456")).toBe(""); // nol di depan / awalan HP
    expect(allowRange("14.08.1991")).toBe("");
  });

  it("#2 value: bulat ≤6 & desimal ≤3; bentuk tanggal, tahun tanpa satuan, telepon, RM polos ditolak", () => {
    for (const v of ["1408.1991", "0812345.67", "14.08.1991", "14-08-1991", "14081991", "+6281234567", "1234567", "87654321", "1234567890", "4.500.000", "1.2345"]) {
      expect(allowValue(v), v).toBeNull();
    }
    expect(allowValue("1991", "")).toBeNull();
    expect(allowValue("1991", "mg/dL")).toBe("1991");
    expect(allowValue("123456")).toBe("123456");
  });

  it("#3 maks. 60 baris", () => {
    const { rows, dropped } = sanitizeForCloud(Array.from({ length: 75 }, () => row("10.2", "12.0 - 16.0")));
    expect(rows).toHaveLength(MAX_CLOUD_ROWS);
    expect(dropped).toBe(15);
  });

  it("#3 NIK & telepon terpecah lintas baris → seluruh payload ditolak", () => {
    // NIK 3273155410911002 dipecah 4-4-4-4 ke value + rentang dua baris.
    expect(() => sanitizeForCloud([row("3273", "1554 - 1091"), row("1002")])).toThrow(PiiLeakError);
    // NIK 3273155408911002 dipecah 6-6-4 ke value tiga baris.
    expect(() => sanitizeForCloud([row("327315"), row("540891"), row("1002")])).toThrow(/nik/);
    // HP 0812-3456-7890 → "0.812" + "3456" + rentang "7890 - 9000".
    expect(() => sanitizeForCloud([row("0.812"), row("3456", "7890 - 9000")])).toThrow(/phone/);
    // Potongan dengan nol di depan bukan bilangan sah → field dibuang sebelum digabung.
    expect(sanitizeForCloud([row("3273", "0554 - 0891"), row("2")]).rows[0].referenceRange).toBe("");
  });

  it("#3 tanpa false positive di data lab fixture a, b, c (urutan asli & terbalik)", () => {
    for (const f of ["a-id-hematologi", "b-us-lipid", "c-id-hematologi-foto"]) {
      const results = loadTruth(f).results;
      expect(sanitizeForCloud(results).dropped, f).toBe(0);
      expect(() => sanitizeForCloud([...results].reverse()), f).not.toThrow();
    }
  });

  it("plausibleNik: struktur NIK", () => {
    expect(plausibleNik("3273055408910002")).toBe(true);
    expect(plausibleNik("3273055413910002")).toBe(false); // bulan 13
    expect(plausibleNik("9973055408910002")).toBe(false); // provinsi
    expect(crossRowPii([{ value: "4.000", referenceRange: "10.000 - 452.000" }])).toEqual([]);
  });
});

describe("zona kepala/kaki fail-closed (#2)", () => {
  it("tanpa batas tabel → zone null & reviewRequired", () => {
    const det = detectPii(pageFromLines(["Siti Rahmawati Putri", "Jl. Kenanga 27 Bandung", "Terima kasih"]));
    expect(det.zone).toBeNull();
    expect(det.reviewRequired).toBe(true);
  });

  it("header tabel di baris pertama (tidak ada kepala) juga fail-closed", () => {
    const det = detectPii(pageFromLines(["Pemeriksaan    Hasil    Satuan    Rujukan", "Hemoglobin    10.2    g/dL    12.0 - 16.0"]));
    expect(det.reviewRequired).toBe(true);
  });

  it("area kaki di bawah tabel disensor (teks & gambar), tabel tetap", () => {
    const page = pageFromLines([
      "Klinik Sentosa Medika",
      "Pemeriksaan    Hasil    Satuan    Rujukan",
      "Hemoglobin    10.2    g/dL    12.0 - 16.0",
      "Leukosit    13800    /uL    4000 - 10000",
      "Diverifikasi oleh Budi Hartono",
      "Bandung, ditandatangani Rina",
    ]);
    const det = detectPii(page);
    expect(det.reviewRequired).toBe(false);
    expect(det.footer).not.toBeNull();
    expect(redactText(page, det).split("\n").slice(1)).toEqual([
      "Pemeriksaan Hasil Satuan Rujukan",
      "Hemoglobin 10.2 g/dL 12.0 - 16.0",
      "Leukosit 13800 /uL 4000 - 10000",
      "[DISENSOR]",
      "[DISENSOR]",
    ]);
    expect(findPii("Hartono", knownPiiFrom(page, det))).toEqual(["known"]);
  });
});

describe("guard: normalisasi Unicode & tokenisasi JSON (#4)", () => {
  it("NIK fullwidth, dengan zero-width, digit Arab-Indik, dan salah baca OCR di dalam JSON.stringify", () => {
    expect(findPii("３２７３０１５４０８９１０００２")).toContain("nik");
    expect(findPii("3273​0154‌0891⁠0002")).toContain("nik");
    expect(findPii("٣٢٧٣٠١٥٤٠٨٩١٠٠٠٢")).toContain("nik");
    expect(findPii(JSON.stringify([{ testName: "Hb", value: "32730l54O89l0002" }]))).toContain("nik");
    expect(findPii(JSON.stringify({ note: "telp O812-3456-789O" }))).toContain("phone");
  });

  it("payload hasil lab bersih tetap lolos setelah normalisasi", () => {
    expect(findPii(JSON.stringify(loadTruth("a-id-hematologi").results))).toEqual([]);
    expect(findPii(JSON.stringify(loadTruth("b-us-lipid").results))).toEqual([]);
  });
});

describe("pola tambahan (#5)", () => {
  it("tanggal dd-mm-yy, dd.mm.yy, '5th March 1990', 'Maret 1990'", () => {
    expect(findPii("lahir 14-08-91")).toEqual(["date"]);
    expect(findPii("lahir 14.08.91")).toEqual(["date"]);
    expect(findPii("born 5th March 1990")).toEqual(["date"]);
    expect(findPii("born March 5th, 1990")).toEqual(["date"]);
    expect(findPii("sejak Maret 1990")).toEqual(["date"]);
    // Nilai lab tidak dianggap tanggal.
    expect(findPii("Kreatinin 0.6-1.2 Trombosit 150.000 - 400.000 HbA1c <5.7")).toEqual([]);
  });

  it("label tanpa ':' dan 'No. Lab' diblokir guard", () => {
    expect(findPii("Nama Pasien Siti")).toEqual(["label"]);
    expect(findPii("No. Lab 2411")).toEqual(["label"]);
    expect(findPii("Lab No: A-17")).toEqual(["label"]);
    expect(findPii("nama tes dan nilai")).toEqual([]);
  });

  it("No. RM: tidak peka huruf besar/kecil dan toleran salah baca OCR", () => {
    expect(findPii("rm-2024-087531")).toContain("medical_record_number");
    expect(findPii("RM-2O24-O87531")).toContain("medical_record_number");
    expect(findPii("mrn 123456")).toContain("medical_record_number");
  });
});

// ---------- geometri redaksi (#8): rasterisasi bentuk tanpa canvas ----------

function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function blackAt(page: OcrPage, det: PiiDetection) {
  const { rects, polys } = redactionShapes(page, det);
  return (x: number, y: number) =>
    rects.some(([rx, ry, w, h]) => x >= rx && x <= rx + w && y >= ry && y <= ry + h) || polys.some((p) => inPoly(x, y, p));
}

/** Piksel di dalam bbox (dengan margin), grid 2 px. */
function pixels(b: { x0: number; y0: number; x1: number; y1: number }, margin = 1): [number, number][] {
  const out: [number, number][] = [];
  for (let x = b.x0 + margin; x <= b.x1 - margin; x += 2) for (let y = b.y0 + margin; y <= b.y1 - margin; y += 2) out.push([x, y]);
  return out;
}

describe.each(["a-id-hematologi", "b-us-lipid", "c-id-hematologi-foto"])("piksel redaksi %s (#8)", (name) => {
  const page = loadPage(name);
  const det = detectPii(page);
  const black = blackAt(page, det);

  it("bbox OCR sejajar dengan gambar (di dalam batas)", () => {
    expect(bboxesFit(page)).toBe(true);
  });

  it("setiap piksel kata PII (span + zona kepala/kaki) tertutup hitam", () => {
    const words = new Set([...det.spans.flatMap((s) => s.words), ...det.zoneWords]);
    const leaks = [...words].filter((w) => pixels(page.words[w].bbox).some(([x, y]) => !black(x, y)));
    expect(leaks.map((w) => page.words[w].text)).toEqual([]);
  });

  it("baris tabel hasil lab tidak tertutup (titik tengah tiap kata)", () => {
    const truth = loadTruth(name);
    const values = new Set(truth.results.map((r) => r.value));
    const covered = page.words.filter((w) => values.has(w.text) && w.text.length >= 3 && black((w.bbox.x0 + w.bbox.x1) / 2, (w.bbox.y0 + w.bbox.y1) / 2));
    expect(covered.map((w) => w.text)).toEqual([]);
  });
});

describe("bboxesFit (#8)", () => {
  it("bbox di luar gambar (koordinat gambar terputar vs gambar asli) → false", () => {
    const page = pageFromLines(["Hemoglobin 10.2"]);
    expect(bboxesFit(page)).toBe(true);
    expect(bboxesFit({ ...page, width: 50 })).toBe(false);
    expect(bboxesFit({ ...page, words: [{ ...page.words[0], bbox: { x0: -30, y0: 0, x1: 10, y1: 10 } }] })).toBe(false);
  });
});

describe("buildCloudPayload: guard nilai dokumen sesudah allowlist", () => {
  const row = { testName: "Albumin", value: "62701", unit: "g/dL", referenceRange: "3.5 - 5.2", flag: "high" };

  it("angka dari kepala/kaki dokumen (kode pos) di value → diblokir", () => {
    expect(() => buildCloudPayload([row], { phrases: [], tokens: ["62701"] })).toThrow(PiiLeakError);
  });

  it("kata dokumen yang hanya kosakata allowlist (legenda 'H = High', 'test') tidak memblokir", () => {
    expect(() => buildCloudPayload([{ ...row, value: "4.1" }], { phrases: [], tokens: ["High,", "Albumin", "test"] })).not.toThrow();
  });

  it("regresi: fixture b (legenda di zona kaki) lolos dengan known dari OCR nyata", () => {
    const page = loadPage("b-us-lipid");
    const known = knownPiiFrom(page, detectPii(page));
    const p = buildCloudPayload(loadTruth("b-us-lipid").results, known);
    expect(p.sentRows).toBe(8);
    for (const tok of ["CARTER", "MICHAEL", "62704", "00483921", "Willow"]) expect(p.text).not.toContain(tok);
  });
});
