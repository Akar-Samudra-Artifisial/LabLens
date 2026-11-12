// Jalankan OCR tesseract.js (Node, aset lokal) atas fixture spike, simpan OcrPage (kata + bbox) sebagai
// fixture test aturan PII: src/lib/pii/__fixtures__/<nama>.ocr.json. Parameter sama dengan src/lib/ocr/tesseract.ts.
//   pnpm ocr:assets && pnpm ocr:fixtures      (Node ≥ 23: impor .ts langsung)
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";
import { OCR_MIN_GOOD_CHARS, OCR_PASSES, ocrQuality, toOcrPage } from "../src/lib/ocr/from-tesseract.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "spike", "fixtures");
const OUT = join(ROOT, "src", "lib", "pii", "__fixtures__");
// tesseract.js Node membaca `${langPath}/${lang}.traineddata.gz`.
const langPath = join(ROOT, "public", "tesseract", "lang");

/** Ukuran PNG (IHDR) / JPEG (SOFn) tanpa dependency. */
function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("ukuran gambar tidak terbaca");
}

await mkdir(OUT, { recursive: true });
const worker = await createWorker(["ind", "eng"], 1, { langPath, cacheMethod: "none", gzip: true });
const images = (await readdir(FIX)).filter((f) => /\.(png|jpe?g)$/.test(f)).sort();
for (const img of images) {
  const buf = await readFile(join(FIX, img));
  const { width, height } = imageSize(buf);
  const t0 = performance.now();
  let best = null;
  for (const psm of OCR_PASSES) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(buf, { rotateAuto: true }, { blocks: true });
    const page = toOcrPage(data, width, height);
    const q = ocrQuality(page);
    if (!best || q > best.q) best = { page, q, psm, rotateRadians: data.rotateRadians ?? 0 };
    if (q >= OCR_MIN_GOOD_CHARS) break;
  }
  const ms = Math.round(performance.now() - t0);
  const { page, q, psm, rotateRadians } = best;
  const name = img.replace(/\.(png|jpe?g)$/, "");
  await writeFile(join(OUT, `${name}.ocr.json`), JSON.stringify({ image: img, ocrMs: ms, psm, rotateRadians, ...page }) + "\n");
  console.log(img, `${width}x${height}`, `${ms} ms`, `psm ${psm}`, `q ${q}`, `${page.words.length} kata`, `${page.lines.length} baris`);
}
await worker.terminate();
