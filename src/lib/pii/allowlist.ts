import { normWords, PiiLeakError } from "./guard";
import { editDistance } from "./patterns";

/**
 * Allowlist per field untuk data yang boleh keluar ke cloud. Output Nano (yang membaca gambar asli) TIDAK
 * dipercaya: hanya bentuk yang dikenal yang lolos, sisanya dibuang. Guard pola (`assertNoPii`) tetap
 * dijalankan sesudahnya sebagai lapisan kedua.
 *
 * - testName → dicocokkan ke kamus tes lab ID/EN; yang dikirim adalah NAMA KANONIK dari kamus, bukan teks model.
 *   Tidak dikenal → seluruh baris tidak dikirim (lebih aman daripada mengirim nilai tanpa konteks).
 * - value → angka (bulat ≤6, desimal ≤3 digit; bukan bentuk tanggal/telepon) atau kualifier pendek; selain itu baris dibuang.
 * - unit → charset terbatas + harus ada di daftar unit umum; selain itu dikosongkan.
 * - referenceRange → pola numerik (tiap sisi bulat ≤5, desimal ≤3; total ≤12 digit) atau kualifier; selain itu dikosongkan.
 * - Maks. 60 baris; NIK/telepon terpecah lintas baris → seluruh payload ditolak (`crossRowPii`).
 * - flag → enum.
 */

export interface CloudRowInput {
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: string;
}

export interface CloudRow {
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: string;
}

export const MAX_LEN = { testName: 40, value: 16, unit: 16, referenceRange: 30 } as const;

const FLAGS = new Set(["low", "normal", "high", "critical", "unknown"]);

/** Nama kanonik → alias (ID/EN, singkatan). Alias dinormalisasi oleh `normName`. */
const LAB_TESTS: Readonly<Record<string, readonly string[]>> = {
  Hemoglobin: ["hemoglobin", "haemoglobin", "hb", "hgb"],
  Hematokrit: ["hematokrit", "hematocrit", "ht", "hct", "pcv"],
  Leukosit: ["leukosit", "lekosit", "leukocytes", "leukocyte", "wbc", "white blood cells", "white blood cell count", "jumlah leukosit"],
  Eritrosit: ["eritrosit", "erythrocytes", "erythrocyte", "rbc", "red blood cells", "red blood cell count", "jumlah eritrosit"],
  Trombosit: ["trombosit", "platelets", "platelet", "plt", "platelet count", "jumlah trombosit"],
  MCV: ["mcv"],
  MCH: ["mch"],
  MCHC: ["mchc"],
  RDW: ["rdw", "rdw cv", "rdw sd"],
  MPV: ["mpv"],
  LED: ["led", "laju endap darah", "esr", "erythrocyte sedimentation rate"],
  Eosinofil: ["eosinofil", "eosinophils", "eosinophil", "eos"],
  Basofil: ["basofil", "basophils", "basophil", "baso"],
  Neutrofil: ["neutrofil", "neutrophils", "neutrophil"],
  "Neutrofil Segmen": ["neutrofil segmen", "segmen", "neutrofil segmented", "segmented neutrophils"],
  "Neutrofil Batang": ["neutrofil batang", "batang", "band neutrophils", "stab"],
  Limfosit: ["limfosit", "lymphocytes", "lymphocyte", "lymph"],
  Monosit: ["monosit", "monocytes", "monocyte", "mono"],
  "Glukosa Puasa": ["glukosa puasa", "gula darah puasa", "gdp", "glucose fasting", "fasting glucose", "fasting blood glucose", "fbg"],
  "Glukosa Sewaktu": ["glukosa sewaktu", "gula darah sewaktu", "gds", "random glucose", "random blood glucose"],
  "Glukosa 2 Jam PP": ["glukosa 2 jam pp", "gula darah 2 jam pp", "gd2pp", "2 hour postprandial glucose"],
  Glukosa: ["glukosa", "glucose", "gula darah"],
  HbA1c: ["hba1c", "hemoglobin a1c", "a1c", "glycated hemoglobin", "glikohemoglobin"],
  "Kolesterol Total": ["kolesterol total", "total cholesterol", "cholesterol", "kolesterol"],
  "Kolesterol HDL": ["hdl", "hdl cholesterol", "kolesterol hdl", "hdl c"],
  "Kolesterol LDL": ["ldl", "ldl cholesterol", "kolesterol ldl", "ldl c", "ldl direk", "ldl direct"],
  "Kolesterol VLDL": ["vldl", "vldl cholesterol", "kolesterol vldl"],
  "Kolesterol Non-HDL": ["non hdl cholesterol", "non hdl", "kolesterol non hdl"],
  Trigliserida: ["trigliserida", "trigliserid", "triglycerides", "triglyceride", "tg"],
  Ureum: ["ureum", "urea"],
  BUN: ["bun", "blood urea nitrogen"],
  Kreatinin: ["kreatinin", "creatinine", "creat"],
  "Asam Urat": ["asam urat", "uric acid"],
  SGOT: ["sgot", "ast", "sgot ast", "aspartate aminotransferase"],
  SGPT: ["sgpt", "alt", "sgpt alt", "alanine aminotransferase"],
  Albumin: ["albumin"],
  Globulin: ["globulin"],
  "Protein Total": ["protein total", "total protein"],
  "Bilirubin Total": ["bilirubin total", "total bilirubin"],
  "Bilirubin Direk": ["bilirubin direk", "bilirubin direct", "direct bilirubin"],
  "Bilirubin Indirek": ["bilirubin indirek", "bilirubin indirect", "indirect bilirubin"],
  "Alkali Fosfatase": ["alkali fosfatase", "alkaline phosphatase", "alp"],
  "Gamma GT": ["gamma gt", "ggt", "gamma glutamyl transferase"],
  Natrium: ["natrium", "sodium", "na"],
  Kalium: ["kalium", "potassium", "k"],
  Klorida: ["klorida", "chloride", "cl"],
  Kalsium: ["kalsium", "calcium", "ca"],
  Magnesium: ["magnesium", "mg"],
  Fosfat: ["fosfat", "phosphate", "phosphorus"],
  eGFR: ["egfr", "laju filtrasi glomerulus"],
  TSH: ["tsh"],
  FT4: ["ft4", "free t4"],
  T3: ["t3"],
  T4: ["t4"],
  CRP: ["crp", "c reactive protein"],
  "hs-CRP": ["hs crp", "hscrp"],
  Feritin: ["feritin", "ferritin"],
  "Serum Iron": ["serum iron", "besi serum", "si"],
  TIBC: ["tibc"],
  "Vitamin D": ["vitamin d", "25 oh vitamin d", "vitamin d 25 oh"],
  "Vitamin B12": ["vitamin b12"],
  "Asam Folat": ["asam folat", "folic acid", "folate"],
  PT: ["pt", "prothrombin time"],
  APTT: ["aptt"],
  INR: ["inr"],
  Fibrinogen: ["fibrinogen"],
  "D-Dimer": ["d dimer"],
  Prokalsitonin: ["prokalsitonin", "procalcitonin"],
  HBsAg: ["hbsag"],
  "Anti HCV": ["anti hcv"],
  "Anti HIV": ["anti hiv"],
  "NS1 Dengue": ["ns1", "ns1 dengue", "dengue ns1"],
  "Dengue IgG": ["dengue igg", "igg dengue"],
  "Dengue IgM": ["dengue igm", "igm dengue"],
  Troponin: ["troponin", "troponin i", "troponin t"],
  "CK-MB": ["ck mb", "ckmb"],
  LDH: ["ldh"],
  Amilase: ["amilase", "amylase"],
  Lipase: ["lipase"],
  PSA: ["psa"],
  "Golongan Darah": ["golongan darah", "blood type", "blood group"],
  Rhesus: ["rhesus", "rh"],
  "pH Urin": ["ph urin", "ph", "urine ph"],
  "Berat Jenis": ["berat jenis", "specific gravity", "bj"],
  "Protein Urin": ["protein urin", "urine protein"],
  "Glukosa Urin": ["glukosa urin", "urine glucose"],
  Keton: ["keton", "ketone", "ketones"],
  Nitrit: ["nitrit", "nitrite"],
  Urobilinogen: ["urobilinogen"],
  "Leukosit Esterase": ["leukosit esterase", "leukocyte esterase"],
};

/** Token yang tidak mengubah identitas tes ("(calc)", "darah" pada "kreatinin darah"). */
const NOISE_TOKENS = new Set(["calc", "calculated", "hitung", "serum", "plasma", "darah", "blood", "level", "kadar"]);

function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !NOISE_TOKENS.has(t))
    .join(" ");
}

const ALIASES: readonly { canon: string; alias: string; key: string; tokens: string }[] = Object.entries(LAB_TESTS).flatMap(
  ([canon, aliases]) =>
    [canon, ...aliases].map((a) => {
      const alias = normName(a);
      return { canon, alias, key: alias.replace(/ /g, ""), tokens: alias.split(" ").sort().join(" ") };
    }),
);

/** Nama kanonik untuk nama tes (alias persis, urutan kata bebas, atau salah ketik 1–2 huruf); null = tidak dikenal. */
export function canonicalTestName(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const n = normName(raw);
  if (!n) return null;
  const key = n.replace(/ /g, "");
  const sorted = n.split(" ").sort().join(" ");
  const exact = ALIASES.find((a) => a.alias === n || a.key === key || a.tokens === sorted);
  if (exact) return exact.canon;
  // Toleransi salah baca ("Hemoglobin Alc") hanya untuk nama cukup panjang agar singkatan tidak tertukar.
  if (key.length < 5) return null;
  const maxDist = key.length >= 10 ? 2 : 1;
  let best: { canon: string; d: number } | null = null;
  for (const a of ALIASES) {
    if (a.key.length < 5 || Math.abs(a.key.length - key.length) > maxDist) continue;
    const d = editDistance(key, a.key);
    if (d <= maxDist && (!best || d < best.d)) best = { canon: a.canon, d };
  }
  return best?.canon ?? null;
}

const clean = (s: unknown): string =>
  typeof s === "string" ? s.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim() : "";

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

const QUALIFIERS = new Set([
  "negatif", "negative", "neg", "positif", "positive", "pos", "+", "++", "+++", "++++", "-", "trace", "reaktif", "reactive",
  "non reaktif", "nonreaktif", "non reactive", "nonreactive", "normal", "abnormal", "jernih", "clear", "keruh", "cloudy",
  "kuning", "yellow", "a", "b", "ab", "o", "rh+", "rh-", "rh positif", "rh negatif",
]);

/** Total digit maksimum di string field mana pun (NIK = 16, telepon ≥ 10). */
export const MAX_FIELD_DIGITS = 12;
export const MAX_CLOUD_ROWS = 60;

/**
 * Satu bilangan: bagian bulat ≤ maxInt digit, desimal ≤ maxDec digit, tanpa nol di depan ("0812" ditolak, "0.8" boleh).
 * "150.000" ambigu (ribuan atau desimal) — lolos bila salah satu tafsiran memenuhi batas.
 */
function numberOk(s: string, maxInt: number, maxDec: number): boolean {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
  if (m) {
    const [, int, dec = ""] = m;
    if (int.length > 1 && int.startsWith("0")) return false;
    if (int.length <= maxInt && dec.length <= maxDec) return true;
  }
  // Pengelompokan ribuan ("4.500" / "13.800" / "1,250,000"): seluruh digit dihitung sebagai bagian bulat.
  return /^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(s) && digitCount(s) <= maxInt;
}

const SEP = String.raw`\s?(?:-|–|s/?d|to)\s?`;
const VALUE_RE = /^(?:[<>≤≥]=?\s?)?[+-]?([\d.,]+)$/;
const RANGE_RE = new RegExp(String.raw`^(?:([\d.,]+)${SEP}([\d.,]+)|[<>≤≥]=?\s?([\d.,]+))$`, "i");

/** Bentuk mirip tanggal lahir: 14.08.1991, 14-8-91?, 1408.1991, 14081991. */
const DATE_LIKE = [
  /\d{1,2}[.\-/]\d{1,2}[.\-/]?(?:19|20)\d{2}/,
  /^\d{2}\d{2}[.\-/]?(?:19|20)\d{2}$/,
  /^(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])(?:19|20)\d{2}$/,
];
const YEAR_ONLY = /^(?:19|20)\d{2}$/;
/** Awalan telepon Indonesia (08…, +62/62…) dengan ≥ 8 digit. */
const PHONE_LIKE = (s: string) => /^[<>≤≥=\s+-]*(?:0\s?8|\+?\s?62)/.test(s) && digitCount(s) >= 8;

/** Nilai hasil: angka (bulat ≤6, desimal ≤3) atau kualifier; null = tidak boleh dikirim. `unit` = satuan yang sudah lolos allowlist. */
export function allowValue(raw: unknown, unit = "x"): string | null {
  const v = clean(raw);
  if (!v || v.length > MAX_LEN.value || digitCount(v) > MAX_FIELD_DIGITS) return null;
  if (DATE_LIKE.some((re) => re.test(v)) || PHONE_LIKE(v) || (!unit && YEAR_ONLY.test(v))) return null;
  const m = VALUE_RE.exec(v);
  if (m && numberOk(m[1], 6, 3)) return v;
  return QUALIFIERS.has(v.toLowerCase()) ? v.toLowerCase() : null;
}

/** Rentang rujukan: tiap sisi bulat ≤5 & desimal ≤3 digit, total ≤12 digit; atau kualifier. Selain itu "" (tidak dikirim). */
export function allowRange(raw: unknown): string {
  const v = clean(raw);
  if (!v || v.length > MAX_LEN.referenceRange || digitCount(v) > MAX_FIELD_DIGITS) return "";
  if (DATE_LIKE.some((re) => re.test(v)) || PHONE_LIKE(v)) return "";
  const m = RANGE_RE.exec(v);
  if (m && [m[1], m[2], m[3]].filter((s) => s !== undefined).every((s) => numberOk(s, 5, 3))) return v;
  return QUALIFIERS.has(v.toLowerCase()) ? v.toLowerCase() : "";
}

/** Kode provinsi Dukcapil (2 digit pertama NIK). */
const NIK_PROVINCES = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36", "51", "52", "53",
  "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76", "81", "82", "91", "92", "93", "94",
]);

/** 16 digit berstruktur NIK: provinsi valid, kab/kec ≠ 00, tanggal lahir (perempuan +40) & bulan valid, nomor urut ≠ 0000. */
export function plausibleNik(d: string): boolean {
  if (!/^\d{16}$/.test(d) || !NIK_PROVINCES.has(d.slice(0, 2)) || d.slice(2, 4) === "00" || d.slice(4, 6) === "00") return false;
  const day = Number(d.slice(6, 8));
  const month = Number(d.slice(8, 10));
  return ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12 && d.slice(12) !== "0000";
}

/** Nomor HP Indonesia: 08[1-9]… 10–13 digit atau 628[1-9]… 11–14 digit. */
const PHONE_DIGITS = /^(?:08[1-9]\d{7,10}|628[1-9]\d{7,10})$/;

/**
 * Deteksi PII yang dipecah ke beberapa field/baris: bilangan di `value` + `referenceRange` diurutkan per baris, lalu tiap
 * rangkaian bilangan berurutan (masing-masing ≥3 digit — potongan NIK/telepon tercetak 4–6 digit) digabung dan dicek
 * sebagai NIK berstruktur / nomor HP. Bilangan <3 digit memutus rangkaian; gabungan dihitung per batas bilangan (bukan
 * digit bebas) agar data lab biasa tidak salah terdeteksi.
 */
export function crossRowPii(rows: readonly Pick<CloudRow, "value" | "referenceRange">[]): string[] {
  const chunks = rows.flatMap((r) => `${r.value} ${r.referenceRange}`.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/\D/g, ""));
  const kinds = new Set<string>();
  for (let i = 0; i < chunks.length; i++) {
    let s = "";
    for (let j = i; j < chunks.length && chunks[j].length >= 3 && s.length < 16; j++) {
      s += chunks[j];
      if (j === i) continue; // satu field sudah dibatasi ≤12 digit & awalan telepon
      if (s.length === 16 && plausibleNik(s)) kinds.add("nik");
      if (PHONE_DIGITS.test(s)) kinds.add("phone");
    }
  }
  return [...kinds];
}

const UNIT_CHARSET = /^[A-Za-zµ%/^.\d³²×*\s-]+$/;
const UNITS = new Set(
  [
    "g/dl", "g/l", "mg/dl", "mg/l", "µg/dl", "ug/dl", "ng/dl", "ng/ml", "pg/ml", "µg/l", "ug/l", "mmol/l", "µmol/l", "umol/l",
    "mmol/mol", "meq/l", "%", "/µl", "/ul", "/mm3", "/mm³", "sel/µl", "sel/ul", "10^3/µl", "10^3/ul", "x10^3/µl", "x10^3/ul",
    "10^6/µl", "10^6/ul", "x10^6/µl", "x10^6/ul", "10^9/l", "x10^9/l", "10^12/l", "x10^12/l", "10³/µl", "10³/ul", "ribu/µl",
    "ribu/ul", "rb/µl", "rb/ul", "juta/µl", "juta/ul", "jt/µl", "jt/ul", "fl", "pg", "mm/jam", "mm/1jam", "mm/h", "mm/hr",
    "u/l", "iu/l", "mu/l", "miu/l", "µiu/ml", "uiu/ml", "miu/ml", "iu/ml", "u/ml", "ml/min/1.73m2", "ml/min/1.73m²",
    "ml/menit/1.73m2", "detik", "sec", "s", "mg/24jam", "mg/24h", "/lpb", "/lpk", "sel/lpb", "sel/lpk", "g/24jam", "ratio", "rasio",
  ].map((u) => u.replace(/\s/g, "")),
);

/** Satuan dari daftar umum; selain itu "" (tidak dikirim). */
export function allowUnit(raw: unknown): string {
  const v = clean(raw).replace(/μ/g, "µ");
  if (!v || v.length > MAX_LEN.unit || !UNIT_CHARSET.test(v)) return "";
  return UNITS.has(v.toLowerCase().replace(/\s/g, "")) ? v : "";
}

/**
 * Semua kata yang bisa muncul di payload dari kode (bukan dari dokumen): nama/alias tes, flag, kualifier, satuan, key JSON.
 * Kata dokumen (mis. legenda "H = High") yang kebetulan sama tidak bisa membocorkan apa pun lewat payload ini.
 */
export const ALLOWLIST_WORDS: ReadonlySet<string> = new Set(
  [
    ...Object.entries(LAB_TESTS).flatMap(([c, a]) => [c, ...a]),
    ...FLAGS,
    ...QUALIFIERS,
    ...UNITS,
    "testName value unit referenceRange flag",
  ].flatMap((s) => normWords(s).split(" ")).filter(Boolean),
);

/** Alasan baris tidak dikirim. Hanya indeks + alasan — tanpa teks dokumen. */
export type DropReason = "unknown_test" | "value_not_allowed" | "row_limit";

export interface DroppedRow {
  /** Indeks baris di input (0-based). */
  index: number;
  reason: DropReason;
}

export interface CloudRows {
  rows: CloudRow[];
  /** Indeks input (0-based) tiap baris di `rows`. */
  sentIndices: number[];
  /** Baris yang tidak dikirim (nama tes tidak dikenal / nilai di luar allowlist). */
  dropped: number;
  droppedRows: DroppedRow[];
}

/**
 * Terapkan allowlist ke tiap baris (maks. MAX_CLOUD_ROWS); yang tersisa hanya field yang lolos (nama kanonik kamus).
 * NIK/telepon yang terpecah lintas field/baris → PiiLeakError (seluruh payload ditolak).
 */
export function sanitizeForCloud(results: readonly CloudRowInput[]): CloudRows {
  const rows: CloudRow[] = [];
  const droppedRows: DroppedRow[] = [];
  const sentIndices: number[] = [];
  for (const [index, r] of results.slice(0, MAX_CLOUD_ROWS).entries()) {
    const testName = canonicalTestName(r.testName);
    const unit = allowUnit(r.unit);
    const value = allowValue(r.value, unit);
    if (!testName || value === null) {
      droppedRows.push({ index, reason: !testName ? "unknown_test" : "value_not_allowed" });
      continue;
    }
    sentIndices.push(index);
    rows.push({
      testName: testName.slice(0, MAX_LEN.testName),
      value,
      unit,
      referenceRange: allowRange(r.referenceRange),
      flag: FLAGS.has(r.flag) ? r.flag : "unknown",
    });
  }
  const split = crossRowPii(rows);
  if (split.length > 0) throw new PiiLeakError(split.map((k) => `${k} (lintas baris)`));
  for (let index = MAX_CLOUD_ROWS; index < results.length; index++) droppedRows.push({ index, reason: "row_limit" });
  return { rows, sentIndices, dropped: results.length - rows.length, droppedRows };
}
