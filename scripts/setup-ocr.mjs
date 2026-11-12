// Salin aset OCR tesseract.js ke public/tesseract/ agar OCR berjalan tanpa CDN (offline).
// Sumber: node_modules (tesseract.js, tesseract.js-core, @tesseract.js-data/{ind,eng} — model 4.0.0_best_int, LSTM saja).
//   pnpm ocr:assets   (juga dijalankan otomatis oleh postinstall)
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "tesseract");
const require = createRequire(join(ROOT, "package.json"));
const tessDir = dirname(require.resolve("tesseract.js/package.json"));
// tesseract.js-core adalah dependency tesseract.js (tidak di-hoist pnpm) → resolve dari sana.
const coreDir = dirname(createRequire(join(tessDir, "package.json")).resolve("tesseract.js-core/package.json"));

const LANGS = ["ind", "eng"];
// Hanya varian LSTM (createWorker OEM default = LSTM_ONLY); getCore memilih sesuai dukungan SIMD browser.
const CORE_FILES = ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"];

await mkdir(join(OUT, "core"), { recursive: true });
await mkdir(join(OUT, "lang"), { recursive: true });
await copyFile(join(tessDir, "dist", "worker.min.js"), join(OUT, "worker.min.js"));
for (const f of CORE_FILES) await copyFile(join(coreDir, f), join(OUT, "core", f));
for (const lang of LANGS) {
  const dataDir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  await copyFile(join(dataDir, "4.0.0_best_int", `${lang}.traineddata.gz`), join(OUT, "lang", `${lang}.traineddata.gz`));
}
console.log(`aset OCR → ${OUT}`);
