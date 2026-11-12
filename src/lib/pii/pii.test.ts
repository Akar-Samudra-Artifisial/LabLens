import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digitize } from "./patterns";
import {
  assertNoPii,
  countByKind,
  detectPii,
  findPii,
  knownPiiFrom,
  type OcrPage,
  type PiiDetection,
  PiiLeakError,
  type PiiSpanKind,
  redactText,
} from "./index";

// ---------- fixture OCR nyata (scripts/ocr-fixtures.mjs) vs ground truth spike ----------

interface Truth {
  results: { testName: string; value: string; unit: string; referenceRange: string }[];
  pii: { kind: string; text: string }[];
}

const ROOT = join(__dirname, "..", "..", "..");
const loadPage = (name: string): OcrPage => JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${name}.ocr.json`), "utf8"));
const loadTruth = (name: string): Truth =>
  JSON.parse(readFileSync(join(ROOT, "spike", "fixtures", `${name}.truth.json`), "utf8"));

/** Jenis span yang dianggap benar untuk tiap jenis PII ground truth. */
const ACCEPT: Record<string, PiiSpanKind[]> = {
  name: ["name"],
  nik: ["nik"],
  medical_record_number: ["medical_record_number"],
  date_of_birth: ["date_of_birth"],
  address: ["address"],
  phone: ["phone"],
  other: ["doctor", "name", "facility"],
};

const alnum = (s: string) => digitize(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Kata OCR yang merupakan bagian dari teks PII (≥4 huruf/angka campuran, ≥6 untuk angka murni). */
function piiWords(page: OcrPage, text: string): number[] {
  const t = alnum(text);
  return page.words.flatMap((w, i) => {
    const n = alnum(w.text);
    const enough = /^\d+$/.test(n) ? n.length >= 6 : n.length >= 4;
    return enough && t.includes(n) ? [i] : [];
  });
}

interface PiiRecall {
  kind: string;
  /** Kata PII terbaca OCR. */
  seen: number;
  /** Semua kata PII tertutup span/zona. */
  covered: boolean;
  /** Ada span berjenis benar yang menutup kata PII. */
  typed: boolean;
}

function recall(page: OcrPage, det: PiiDetection, truth: Truth): PiiRecall[] {
  const zone = new Set(det.zoneWords);
  return truth.pii.map((p) => {
    const ws = piiWords(page, p.text);
    const spansOf = (w: number) => det.spans.filter((s) => s.words.includes(w));
    return {
      kind: p.kind,
      seen: ws.length,
      covered: ws.length > 0 && ws.every((w) => zone.has(w) || spansOf(w).length > 0),
      typed: ws.some((w) => spansOf(w).some((s) => ACCEPT[p.kind].includes(s.kind))),
    };
  });
}

/** Baris tabel (setelah zona): baris yang memuat pola rentang rujukan. */
function tableRows(page: OcrPage, det: PiiDetection): number[][] {
  const zone = new Set([...det.zoneWords, ...(det.zone?.keepWords ?? [])]);
  return det.rows.filter(
    (r) => !r.some((w) => zone.has(w)) && /\d\s*[-–]\s*\d|[<>]\s?\d/.test(r.map((w) => page.words[w].text).join(" ")),
  );
}

describe.each(["a-id-hematologi", "b-us-lipid"])("fixture %s (OCR nyata)", (name) => {
  const page = loadPage(name);
  const truth = loadTruth(name);
  const det = detectPii(page);

  it("recall PII aturan 100%: setiap PII tertutup dan terdeteksi dengan jenis yang benar", () => {
    const r = recall(page, det, truth);
    expect(r.map((x) => x.seen > 0)).toEqual(r.map(() => true));
    expect(r.filter((x) => !x.covered || !x.typed)).toEqual([]);
  });

  it("teks tersensor tidak memuat token PII ground truth", () => {
    const red = alnum(redactText(page, det));
    for (const p of truth.pii) for (const w of piiWords(page, p.text)) expect(red).not.toContain(alnum(page.words[w].text));
  });

  it("tidak menyensor baris tabel hasil lab (false positive)", () => {
    const rows = tableRows(page, det);
    expect(rows.length).toBeGreaterThanOrEqual(truth.results.length - 1);
    const inSpan = new Set(det.spans.flatMap((s) => s.words));
    expect(rows.flat().filter((w) => inSpan.has(w)).map((w) => page.words[w].text)).toEqual([]);
    const red = redactText(page, det);
    const ocrText = page.words.map((w) => w.text).join(" ");
    for (const r of truth.results) if (ocrText.includes(r.value)) expect(red).toContain(r.value);
  });

  it("zona kepala laporan berakhir sebelum tabel", () => {
    expect(det.zone).not.toBeNull();
    expect(countByKind(det).header).toBe(1);
  });
});

describe("fixture c-id-hematologi-foto (foto miring/buram)", () => {
  const page = loadPage("c-id-hematologi-foto");
  const det = detectPii(page);
  const r = recall(page, det, loadTruth("c-id-hematologi-foto"));

  it("recall: semua PII terbaca OCR tertutup, jenis benar ≥ 6/7 (terukur 7/7)", () => {
    expect(det.zone).not.toBeNull();
    expect(det.reviewRequired).toBe(false);
    const seen = r.filter((x) => x.seen > 0);
    expect(seen.length).toBe(r.length);
    expect(seen.filter((x) => !x.covered).map((x) => x.kind)).toEqual([]);
    expect(seen.filter((x) => x.typed).length).toBeGreaterThanOrEqual(6);
  });

  it("tidak menyensor baris tabel", () => {
    const inSpan = new Set(det.spans.flatMap((s) => s.words));
    expect(tableRows(page, det).flat().filter((w) => inSpan.has(w))).toEqual([]);
  });
});

// ---------- kasus sintetis ----------

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

const spansOf = (lines: string[]) => {
  const page = pageFromLines(lines);
  const det = detectPii(page);
  return { page, det, spans: det.spans.map((s) => [s.kind, s.text] as const), text: redactText(page, det) };
};

describe("aturan PII (sintetis)", () => {
  it("NIK: rapat, berkelompok spasi/titik, dan salah baca OCR (O→0, l→1, S→5)", () => {
    expect(spansOf(["NIK : 3273 0154 0891 0002"]).spans).toEqual([["nik", "3273 0154 0891 0002"]]);
    expect(spansOf(["KTP 3273.0154.0891.0002 terlampir"]).spans).toEqual([["nik", "3273.0154.0891.0002"]]);
    expect(spansOf(["no 327301S4O89l0002"]).spans).toEqual([["nik", "327301S4O89l0002"]]);
  });

  it("telepon & email tanpa label", () => {
    expect(spansOf(["hubungi +62 812-3456-7890 atau siti.r@example.co.id"]).spans).toEqual([
      ["phone", "+62 812-3456-7890"],
      ["email", "siti.r@example.co.id"],
    ]);
    expect(spansOf(["Call (217) 555-0143"]).spans).toEqual([["phone", "(217) 555-0143"]]);
  });

  it("tanggal: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, nama bulan ID/EN", () => {
    expect(spansOf(["diambil 14/08/1991"]).spans).toEqual([["date", "14/08/1991"]]);
    expect(spansOf(["diambil 1991-08-14 pagi"]).spans).toEqual([["date", "1991-08-14"]]);
    expect(spansOf(["Tanggal Lahir: 14 Agustus 1991"]).spans).toEqual([["date_of_birth", "14 Agustus 1991"]]);
    expect(spansOf(["DOB: March 22, 1968"]).spans).toEqual([["date_of_birth", "March 22, 1968"]]);
    expect(spansOf(["Sampel 3 Des 2026 diterima"]).spans).toEqual([["date", "3 Des 2026"]]);
  });

  it("nilai setelah label berhenti di label/kolom berikutnya", () => {
    const { spans, text } = spansOf(["Nama: Budi Santoso    Umur: 45 th", "Dokter: dr. Rina, Sp.PK    Faskes: Puskesmas Coblong"]);
    expect(spans).toEqual([
      ["name", "Budi Santoso"],
      ["doctor", "dr. Rina, Sp.PK"],
      ["facility", "Puskesmas Coblong"],
    ]);
    expect(text).toBe("Nama: [NAMA] Umur: 45 th\nDokter: [DOKTER] Faskes: [FASKES]");
  });

  it("alamat + baris lanjutan sebelum label berikutnya", () => {
    const { spans } = spansOf(["Alamat : Jl. Mawar No. 5", "         Kec. Coblong, Bandung", "No. RM : 00-12-34"]);
    expect(spans).toEqual([
      ["address", "Jl. Mawar No. 5"],
      ["address", "Kec. Coblong, Bandung"],
      ["medical_record_number", "00-12-34"],
    ]);
  });

  it("zona kepala laporan: teks tak berlabel di atas header tabel disensor, judul generik & tabel tetap", () => {
    const { det, text } = spansOf([
      "RS Harapan Sehat Cabang Dago",
      "Budi Santoso, 45 th",
      "KIMIA DARAH",
      "Pemeriksaan    Hasil    Satuan    Nilai Rujukan",
      "Glukosa Puasa    131    mg/dL    70-99",
    ]);
    expect(det.zone).not.toBeNull();
    expect(text.split("\n")).toEqual([
      "RS [DISENSOR]", // kata label ("RS") boleh tampil
      "[DISENSOR]",
      "KIMIA DARAH",
      "Pemeriksaan Hasil Satuan Nilai Rujukan",
      "Glukosa Puasa 131 mg/dL 70-99",
    ]);
  });

  it("tanpa header tabel: baris hasil lab pertama menjadi batas zona", () => {
    const { det, text } = spansOf(["Ibu Ani Wijaya", "Hemoglobin    10.2    g/dL    12.0 - 16.0"]);
    expect(det.zone).not.toBeNull();
    expect(text).toBe("[DISENSOR]\nHemoglobin 10.2 g/dL 12.0 - 16.0");
  });

  it("baris tabel tidak terhapus: angka besar, rentang, tahun-mirip, bertitik", () => {
    const rows = [
      "Pemeriksaan    Hasil    Satuan    Nilai Rujukan",
      "Eritrosit    4.500.000    /uL    4.000.000 - 5.200.000",
      "Trombosit    452.000    /uL    150.000 - 400.000",
      "Leukosit    13800    /uL    4000 - 10000",
      "Kreatinin    1.2    mg/dL    0.6-1.2",
      "HbA1c    6.8    %    <5.7",
      "Vitamin D    20.12    ng/mL    30 - 100",
      "Feritin    2024    ng/mL    15-150",
    ];
    const { spans, text } = spansOf(rows);
    expect(spans).toEqual([]);
    expect(text).toBe(rows.map((r) => r.replace(/\s+/g, " ")).join("\n"));
  });
});

describe("assertNoPii (guard sebelum cloud)", () => {
  const clean = loadTruth("a-id-hematologi").results;

  it("lolos untuk payload hasil lab bersih (fixture a dan b)", () => {
    expect(() => assertNoPii(clean)).not.toThrow();
    expect(() => assertNoPii(loadTruth("b-us-lipid").results)).not.toThrow();
  });

  it("blokir NIK, telepon, email, tanggal, label identitas", () => {
    expect(findPii(JSON.stringify([...clean, { testName: "NIK", value: "3273015408910002" }]))).toContain("nik");
    expect(findPii("hubungi 0812-3456-7890")).toEqual(["phone"]);
    expect(findPii("kirim ke a.b@c.com")).toEqual(["email"]);
    expect(findPii("lahir 14-08-1991")).toEqual(["date"]);
    expect(findPii("Nama Pasien: Siti")).toEqual(["label"]);
    expect(findPii("NIK 32730l54O8910002")).toContain("nik");
  });

  it("blokir nilai PII dokumen yang diketahui walau tanpa pola", () => {
    const page = loadPage("a-id-hematologi");
    const known = knownPiiFrom(page, detectPii(page));
    expect(() => assertNoPii(clean, known)).not.toThrow();
    const leak = [...clean, { testName: "Catatan Siti Rahmawati Putri", value: "1" }];
    expect(() => assertNoPii(leak, known)).toThrow(PiiLeakError);
    // Kata zona header tanpa pola (nama klinik) juga diblokir.
    expect(findPii("Sentosa", known)).toEqual(["known"]);
  });

  it("pesan error hanya menyebut jenis, bukan nilai", () => {
    try {
      assertNoPii({ note: "3273015408910002" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PiiLeakError);
      expect((e as Error).message).not.toContain("3273015408910002");
      expect((e as PiiLeakError).kinds).toEqual(["nik"]);
    }
  });
});
