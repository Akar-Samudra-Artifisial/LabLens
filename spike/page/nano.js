// Dijalankan di halaman http://localhost — meniru ChromeAdapterImpl di @firebase/ai 3.0.0
// (createOptions & konversi pesan sama dengan getOnDeviceExtractionModel + extractOnDevice).
import {
  EXTRACT_PROMPT,
  EXTRACT_PROMPT_LEAN,
  flagFromRange,
  labExtractionJsonSchema,
  labExtractionLeanJsonSchema,
} from "../shared.mjs";

// --- Eksperimen optimasi: waktu per tahap (decode/resize, create|clone, prefill=first chunk, decode output) ---
let baseSession = null;
const EXTRACT_PROMPT_TSV =
  "Salin tabel hasil lab dari gambar ini, satu baris per tes dengan format: nama tes | nilai | satuan | rentang rujukan. " +
  "Tulis persis seperti di gambar, tanpa header. Jangan tulis data identitas apa pun. " +
  "Baris terakhir: PII: diikuti jenis data identitas pasien yang terlihat (name, nik, medical_record_number, date_of_birth, address, phone), dipisah koma.";
const TSV_RE = /([^|\n]{1,60}\|[^|\n]{0,30}\|[^|\n]{0,30}\|[^|\n]{0,40}\n){1,80}PII:( ?(name|nik|medical_record_number|date_of_birth|address|phone|other),?){0,7}/;
window.nanoWarm = async () => {
  const t = performance.now();
  baseSession ??= await LanguageModel.create(CREATE_OPTIONS);
  return Math.round(performance.now() - t);
};

/**
 * opts: { maxSide?: number, schema: "base"|"lean", reuse?: boolean, timeoutMs?: number, maxChars?: number }
 * Output `text` selalu dinormalkan ke format base (results+flag, maskedPii) agar score.mjs bisa dipakai.
 */
window.nanoExtractV = async (imageUrl, opts) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), opts.timeoutMs ?? 600000);
  const t0 = performance.now();
  const blob = await (await fetch(imageUrl)).blob();
  let bitmap = await createImageBitmap(blob);
  const orig = `${bitmap.width}x${bitmap.height}`;
  if (opts.maxSide && Math.max(bitmap.width, bitmap.height) > opts.maxSide) {
    const s = opts.maxSide / Math.max(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * s);
    const h = Math.round(bitmap.height * s);
    bitmap.close();
    bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  }
  const t1 = performance.now();
  const session = opts.reuse
    ? await (baseSession ??= await LanguageModel.create(CREATE_OPTIONS)).clone({ signal: ctrl.signal })
    : await LanguageModel.create({ ...CREATE_OPTIONS, signal: ctrl.signal });
  const t2 = performance.now();
  const lean = opts.schema === "lean";
  const tsv = opts.schema === "tsv";
  let text = "";
  let tFirst = null;
  try {
    const stream = session.promptStreaming(
      [
        {
          role: "user",
          content: [
            { type: "text", value: tsv ? EXTRACT_PROMPT_TSV : lean ? EXTRACT_PROMPT_LEAN : EXTRACT_PROMPT },
            { type: "image", value: bitmap },
          ],
        },
      ],
      tsv
        ? { responseConstraint: TSV_RE, signal: ctrl.signal }
        : { responseConstraint: lean ? labExtractionLeanJsonSchema : labExtractionJsonSchema, signal: ctrl.signal },
    );
    for await (const chunk of stream) {
      tFirst ??= performance.now();
      text += chunk;
      if (opts.maxChars && text.length > opts.maxChars) {
        ctrl.abort(new DOMException("output terlalu panjang", "QuotaExceededError"));
      }
    }
    const t3 = performance.now();
    const outChars = text.length;
    if (tsv) {
      const results = [];
      let kinds = [];
      for (const line of text.split("\n")) {
        if (/^PII:/i.test(line)) {
          kinds = line.slice(4).split(",").map((s) => s.trim()).filter(Boolean);
          continue;
        }
        const [testName, value, unit, referenceRange] = line.split("|").map((s) => s.trim());
        if (testName && value !== undefined) {
          results.push({ testName, value, unit: unit ?? "", referenceRange: referenceRange ?? "", flag: flagFromRange(value, referenceRange) });
        }
      }
      text = JSON.stringify({ results, maskedPii: [...new Set(kinds)].map((kind) => ({ kind, placeholder: `[${kind}]` })) });
    }
    if (lean) {
      const p = JSON.parse(text);
      text = JSON.stringify({
        results: p.results.map((r) => ({ ...r, flag: flagFromRange(r.value, r.referenceRange) })),
        maskedPii: [...new Set(p.piiKinds)].map((kind) => ({ kind, placeholder: `[${kind}]` })),
      });
    }
    return {
      ok: true,
      text,
      image: `${orig}→${bitmap.width}x${bitmap.height}`,
      outChars,
      decodeMs: Math.round(t1 - t0),
      createMs: Math.round(t2 - t1),
      prefillMs: Math.round(tFirst - t2),
      genMs: Math.round(t3 - tFirst),
      promptMs: Math.round(t3 - t2),
      totalMs: Math.round(t3 - t0),
    };
  } catch (e) {
    const err = ctrl.signal.aborted ? ctrl.signal.reason : e;
    return { ok: false, error: `${err.name}: ${err.message}`, outChars: text.length, totalMs: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
    session.destroy();
    bitmap.close();
  }
};

const CREATE_OPTIONS = {
  expectedInputs: [{ type: "text" }, { type: "image" }],
  expectedOutputs: [{ type: "text" }],
};

window.nanoInfo = async () => {
  if (!("LanguageModel" in self)) return { hasApi: false };
  const out = { hasApi: true, availability: await LanguageModel.availability(CREATE_OPTIONS) };
  out.availabilityTextOnly = await LanguageModel.availability();
  try {
    out.params = await LanguageModel.params?.();
  } catch (e) {
    out.paramsError = String(e);
  }
  return out;
};

window.nanoDownload = async () => {
  window.__dl = { loaded: 0, done: false, error: null };
  try {
    const s = await LanguageModel.create({
      ...CREATE_OPTIONS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          window.__dl.loaded = e.loaded;
        });
      },
    });
    s.destroy();
    window.__dl.done = true;
  } catch (e) {
    window.__dl.error = `${e.name}: ${e.message}`;
  }
  return window.__dl;
};

window.nanoExtract = async (imageUrl, promptText) => {
  const t0 = performance.now();
  const blob = await (await fetch(imageUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const t1 = performance.now();
  const session = await LanguageModel.create(CREATE_OPTIONS);
  const t2 = performance.now();
  try {
    const text = await session.prompt(
      [
        {
          role: "user",
          content: [
            { type: "text", value: promptText ?? EXTRACT_PROMPT },
            { type: "image", value: bitmap },
          ],
        },
      ],
      { responseConstraint: labExtractionJsonSchema },
    );
    const t3 = performance.now();
    return {
      ok: true,
      text,
      decodeMs: Math.round(t1 - t0),
      createMs: Math.round(t2 - t1),
      promptMs: Math.round(t3 - t2),
      totalMs: Math.round(t3 - t0),
    };
  } catch (e) {
    return { ok: false, error: `${e.name}: ${e.message}`, totalMs: Math.round(performance.now() - t0) };
  } finally {
    session.destroy();
  }
};
