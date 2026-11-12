// Membuat 3 fixture hasil lab FIKTIF (HTML → gambar) + ground truth.
// Semua nama, NIK, RM, alamat, telepon, dan nilai di sini rekaan.
// Jalankan: node spike/fixtures/make-fixtures.mjs
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const DIR = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const ID = {
  lang: "id",
  lab: "Klinik Pratama Sehat Sentosa",
  labAddr: "Jl. Merpati Raya No. 88, Bandung — Telp (022) 555-0199",
  pii: {
    name: "Siti Rahmawati Putri",
    nik: "3273015408910002",
    medical_record_number: "RM-2024-087531",
    date_of_birth: "14-08-1991",
    address: "Jl. Kenanga Gg. 3 No. 27, RT 04/RW 09, Kel. Sukamaju, Bandung",
    phone: "0812-3456-7890",
    other: "dr. Andi Wijaya, Sp.PD",
  },
  rows: [
    ["Hemoglobin", "10.2", "g/dL", "12.0 - 16.0", "low"],
    ["Leukosit", "13.800", "/µL", "4.000 - 10.000", "high"],
    ["Eritrosit", "3.9", "juta/µL", "4.0 - 5.2", "low"],
    ["Hematokrit", "31.5", "%", "36 - 46", "low"],
    ["Trombosit", "452.000", "/µL", "150.000 - 400.000", "high"],
    ["MCV", "80.8", "fL", "80 - 100", "normal"],
    ["MCH", "26.2", "pg", "27 - 34", "low"],
    ["MCHC", "32.4", "g/dL", "32 - 36", "normal"],
    ["LED", "28", "mm/jam", "0 - 20", "high"],
    ["Eosinofil", "2", "%", "1 - 3", "normal"],
    ["Basofil", "0", "%", "0 - 1", "normal"],
    ["Neutrofil Segmen", "78", "%", "50 - 70", "high"],
    ["Limfosit", "15", "%", "20 - 40", "low"],
    ["Monosit", "5", "%", "2 - 8", "normal"],
  ],
};

const US = {
  lang: "en",
  lab: "Midwest Diagnostic Laboratories",
  labAddr: "900 Commerce Pkwy, Springfield, IL 62701 · CLIA 14D0000000",
  pii: {
    name: "John Michael Carter",
    medical_record_number: "00483921",
    date_of_birth: "03/22/1968",
    address: "1458 Willow Creek Dr, Springfield, IL 62704",
    phone: "(217) 555-0143",
    other: "Laura Chen, MD",
  },
  rows: [
    ["Cholesterol, Total", "242", "mg/dL", "<200", "high"],
    ["Triglycerides", "189", "mg/dL", "<150", "high"],
    ["HDL Cholesterol", "38", "mg/dL", ">39", "low"],
    ["LDL Cholesterol (calc)", "166", "mg/dL", "<100", "high"],
    ["VLDL Cholesterol (calc)", "38", "mg/dL", "5-40", "normal"],
    ["Non-HDL Cholesterol", "204", "mg/dL", "<130", "high"],
    ["Hemoglobin A1c", "6.8", "%", "<5.7", "high"],
    ["Glucose, Fasting", "131", "mg/dL", "65-99", "high"],
  ],
};

const flagMark = (f, lang) =>
  f === "low" ? "L" : f === "high" ? "H" : lang === "id" ? "" : "";

function htmlId(d, extraCss = "") {
  const p = d.pii;
  const rows = d.rows
    .map(
      ([n, v, u, r, f]) =>
        `<tr><td>${n}</td><td class="v ${f !== "normal" ? "ab" : ""}">${v}</td><td>${flagMark(f)}</td><td>${u}</td><td>${r}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111}
.page{width:820px;padding:28px 36px;background:#fff;${extraCss}}
h1{font-size:20px;margin:0}.sub{font-size:12px;color:#444;margin-bottom:10px}
hr{border:0;border-top:2px solid #222}
.hdr{display:grid;grid-template-columns:150px 1fr 120px 1fr;font-size:13px;row-gap:4px;margin:10px 0}
h2{font-size:15px;text-align:center;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #888;padding:5px 8px;text-align:left}th{background:#e8e8e8}
.v.ab{font-weight:bold}.foot{font-size:11px;margin-top:14px;color:#333}
</style></head><body><div class="page">
<h1>${d.lab}</h1><div class="sub">${d.labAddr}</div><hr>
<div class="hdr">
<b>Nama Pasien</b><span>: ${p.name}</span><b>No. RM</b><span>: ${p.medical_record_number}</span>
<b>NIK</b><span>: ${p.nik}</span><b>Tgl. Lahir</b><span>: ${p.date_of_birth} (33 th) / P</span>
<b>Alamat</b><span style="grid-column:span 3">: ${p.address}</span>
<b>No. Telp</b><span>: ${p.phone}</span><b>Tgl. Periksa</b><span>: 03-11-2026 08:15</span>
<b>Dokter Pengirim</b><span>: ${p.other}</span><b>No. Lab</b><span>: LB2611030042</span>
</div>
<h2>HASIL PEMERIKSAAN LABORATORIUM — HEMATOLOGI</h2>
<table><tr><th>Pemeriksaan</th><th>Hasil</th><th>Flag</th><th>Satuan</th><th>Nilai Rujukan</th></tr>${rows}</table>
<div class="foot">Catatan: L = rendah, H = tinggi. Hasil diverifikasi oleh: Analis Lab — Validator: dr. Penanggung Jawab Lab.</div>
</div></body></html>`;
}

function htmlUs(d) {
  const p = d.pii;
  const rows = d.rows
    .map(
      ([n, v, u, r, f]) =>
        `<tr><td>${n}</td><td>${f === "normal" ? v : ""}</td><td class="ab">${f === "normal" ? "" : `${v} ${flagMark(f)}`}</td><td>${r}</td><td>${u}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:"Courier New",monospace;color:#111}
.page{width:860px;padding:26px 34px}
.top{display:flex;justify-content:space-between;font-size:12px}
h1{font-family:Arial;font-size:19px;margin:0 0 2px}
.box{border:1px solid #333;display:grid;grid-template-columns:1fr 1fr;font-size:12px;padding:8px;gap:3px 20px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th{border-bottom:2px solid #000;text-align:left;padding:4px}td{padding:4px;border-bottom:1px dotted #999}
.ab{font-weight:bold}.sec{font-family:Arial;font-weight:bold;font-size:14px;margin-top:12px}
.foot{font-size:11px;margin-top:12px}
</style></head><body><div class="page">
<div class="top"><div><h1>${d.lab}</h1>${d.labAddr}</div><div>Accession: MD-26-3108842<br>Collected: 11/03/2026 07:40<br>Reported: 11/03/2026 14:02</div></div>
<div class="box">
<div>Patient: <b>${p.name.toUpperCase()}</b></div><div>MRN: ${p.medical_record_number}</div>
<div>DOB: ${p.date_of_birth} &nbsp; Sex: M</div><div>Phone: ${p.phone}</div>
<div>Address: ${p.address}</div><div>Ordering Physician: ${p.other}</div>
</div>
<div class="sec">LIPID PANEL, HEMOGLOBIN A1c, GLUCOSE (FASTING)</div>
<table><tr><th>Test</th><th>In Range</th><th>Out of Range</th><th>Reference Range</th><th>Units</th></tr>${rows}</table>
<div class="foot">H = High, L = Low. Fasting: Yes. This test was performed by ${d.lab}.</div>
</div></body></html>`;
}

function truth(d, image, variant) {
  return {
    image,
    variant,
    lang: d.lang,
    results: d.rows.map(([testName, value, unit, referenceRange, flag]) => ({
      testName,
      value,
      unit,
      referenceRange,
      flag,
    })),
    pii: Object.entries(d.pii).map(([kind, text]) => ({ kind, text })),
  };
}

const fixtures = [
  { id: "a-id-hematologi", ext: "png", html: htmlId(ID), data: ID, variant: "clean" },
  { id: "b-us-lipid", ext: "png", html: htmlUs(US), data: US, variant: "clean" },
  {
    id: "c-id-hematologi-foto",
    ext: "jpeg",
    // Simulasi foto HP: rotasi ~5°, blur ringan, kontras rendah, latar kertas abu.
    html: htmlId(
      ID,
      "transform:rotate(5deg);transform-origin:center;margin:110px 70px;filter:blur(0.9px) contrast(0.55) brightness(1.05);box-shadow:0 0 30px #777;background:#f3efe6",
    ).replace("body{margin:0;background:#fff", "body{margin:0;background:#8a8a85"),
    data: ID,
    variant: "rotate5-blur-lowcontrast",
  },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1.5 });
for (const f of fixtures) {
  await page.setContent(f.html);
  const el = f.variant === "clean" ? page.locator(".page") : page.locator("body");
  const file = `${f.id}.${f.ext}`;
  await el.screenshot({
    path: join(DIR, file),
    type: f.ext,
    ...(f.ext === "jpeg" ? { quality: 62 } : {}),
  });
  await writeFile(join(DIR, `${f.id}.html`), f.html);
  await writeFile(join(DIR, `${f.id}.truth.json`), JSON.stringify(truth(f.data, file, f.variant), null, 2) + "\n");
  console.log("ok", file);
}
await browser.close();
