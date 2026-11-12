// Spike: ukur Gemini Nano (Chrome Prompt API) untuk ekstraksi hasil lab + masking PII.
// Pakai Google Chrome terpasang dengan PROFIL TERPISAH (spike/.chrome-profile), bukan profil utama.
//
//   node spike/run-nano.mjs probe            # cek availability()
//   node spike/run-nano.mjs download         # picu & tunggu unduhan model
//   node spike/run-nano.mjs run [N=3]        # jalankan semua fixture N kali + 1 run prompt EN
//   node spike/run-nano.mjs app [N=3]        # app nyata di localhost:3000: OCR+sensor, baris pertama, total, PII, jaringan
//
// Env: HEADLESS=1 untuk --headless=new (default: jendela terlihat, lebih andal untuk on-device model).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { EXTRACT_PROMPT, EXTRACT_PROMPT_EN } from "./shared.mjs";
import { piiLeaks, scoreRun } from "./score.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = join(ROOT, ".chrome-profile");
const CDP_PORT = 9339;
const FEATURES = [
  "OptimizationGuideOnDeviceModel:BypassPerfRequirement/true",
  "PromptAPIForGeminiNano",
  "PromptAPIForGeminiNanoMultimodalInput",
  "AIPromptAPI",
  "AIPromptAPIMultimodalInput",
].join(",");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".jpeg": "image/jpeg", ".json": "application/json" };

function serve() {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel.endsWith("/") ? `${rel}index.html` : rel);
    if (!file.startsWith(ROOT) || file.includes(".chrome-profile")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function launchChrome() {
  await mkdir(PROFILE, { recursive: true });
  const args = [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--enable-features=${FEATURES}`,
    ...(process.env.HEADLESS ? ["--headless=new"] : []),
    "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) break;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  return { proc, browser };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [mode = "probe", nArg] = process.argv.slice(2);
  const server = await serve();
  const origin = `http://localhost:${server.address().port}`;
  const { proc, browser } = await launchChrome();
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(`${origin}/page/index.html`);
  await page.waitForFunction(() => typeof window.nanoInfo === "function");
  const version = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).Browser;
  try {
    const info = await page.evaluate(() => window.nanoInfo());
    console.log(JSON.stringify({ version, ...info }));
    if (mode === "probe") return;

    if (mode === "download") {
      await page.click("#dl");
      for (let i = 0; ; i++) {
        await sleep(15000);
        const s = await page.evaluate(() => ({ dl: window.__dl, a: null }));
        const a = await page.evaluate(() => LanguageModel.availability({ expectedInputs: [{ type: "text" }, { type: "image" }], expectedOutputs: [{ type: "text" }] }));
        console.log(new Date().toISOString(), a, JSON.stringify(s.dl));
        if (s.dl?.done || s.dl?.error || a === "available") break;
        if (i > 240) throw new Error("Unduhan model tidak selesai dalam 60 menit");
      }
      return;
    }

    // node spike/run-nano.mjs opt <variant> [N=3] → tambah ke spike/results-opt.json (fixture a & c)
    if (mode === "opt") {
      if (info.availability !== "available") throw new Error(`Model belum tersedia: ${info.availability}`);
      const VARIANTS = {
        base: { schema: "base", timeoutMs: 120000 },
        "base-1024": { schema: "base", maxSide: 1024, timeoutMs: 120000 },
        "lean-1024": { schema: "lean", maxSide: 1024, timeoutMs: 120000 },
        lean: { schema: "lean", timeoutMs: 120000 },
        tsv: { schema: "tsv", maxSide: 1024, reuse: true, timeoutMs: 60000, maxChars: 6000 },
        app: { schema: "lean", maxSide: 1024, reuse: true, timeoutMs: 60000, maxChars: 6000 },
      };
      const variant = nArg;
      const opts = VARIANTS[variant];
      if (!opts) throw new Error(`variant: ${Object.keys(VARIANTS).join("|")}`);
      const n = Number(process.argv[5] ?? 3);
      const out = join(ROOT, "results-opt.json");
      const all = await readFile(out, "utf8").then(JSON.parse, () => ({ version, runs: [] }));
      if (opts.reuse) console.log("warm-up ms", await page.evaluate(() => window.nanoWarm()));
      for (const tf of ["a-id-hematologi.truth.json", "c-id-hematologi-foto.truth.json"]) {
        const truth = JSON.parse(await readFile(join(ROOT, "fixtures", tf), "utf8"));
        for (let i = 1; i <= n; i++) {
          const r = await page.evaluate(([u, o]) => window.nanoExtractV(u, o), [`${origin}/fixtures/${truth.image}`, opts]);
          const score = scoreRun(truth, r);
          const rec = { variant, fixture: tf.replace(".truth.json", ""), run: i, at: new Date().toISOString(), ...r, score };
          all.runs.push(rec);
          const log = { ...r, text: undefined };
          console.log(JSON.stringify({ variant, fixture: rec.fixture, run: i, ...log, acc: score.summary.fieldAcc, pii: score.summary.piiKindRecall, leaks: score.summary.piiLeaks }));
          await writeFile(out, JSON.stringify(all, null, 2) + "\n");
        }
      }
      return;
    }

    // node spike/run-nano.mjs app [N=3] [APP_URL] → app nyata (dev server), tulis spike/results-app.json.
    // Tiap fixture a, b & c: N run tanpa + N run dengan teks OCR sebagai konteks Nano, lalu 1× "Jelaskan (cloud)".
    // Semua request ke luar localhost dicatat lalu DI-ABORT (tidak ada yang benar-benar terkirim) untuk diperiksa.
    if (mode === "app") {
      if (info.availability !== "available") throw new Error(`Model belum tersedia: ${info.availability}`);
      const n = Number(nArg ?? 3);
      const appUrl = process.argv[4] ?? "http://localhost:3000/";
      const outbound = [];
      await ctx.route(
        (u) => !["localhost", "127.0.0.1"].includes(u.hostname),
        (route) => {
          const req = route.request();
          outbound.push({ url: req.url(), method: req.method(), body: req.postData() ?? "" });
          return route.abort();
        },
      );
      const app = await ctx.newPage();
      app.on("pageerror", (e) => console.error("[app pageerror]", e.message));
      // Semua request (termasuk localhost & worker) + pelanggaran CSP, untuk dicek per ekstraksi.
      const allReqs = [];
      ctx.on("request", (req) => allReqs.push(req.url()));
      const cspViolations = [];
      app.on("console", (m) => {
        if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text().slice(0, 200));
      });
      await app.goto(appUrl);
      await app.waitForFunction(() => /model: ready|model: failed/.test(document.body.innerText), null, { timeout: 120000 });
      console.log("warm-up:", (await app.locator("p", { hasText: "model:" }).first().innerText()).trim());
      const runs = [];
      for (const tf of ["a-id-hematologi.truth.json", "b-us-lipid.truth.json", "c-id-hematologi-foto.truth.json"]) {
        const truth = JSON.parse(await readFile(join(ROOT, "fixtures", tf), "utf8"));
        const fixture = tf.replace(".truth.json", "");
        await app.setInputFiles('input[type="file"]', join(ROOT, "fixtures", truth.image));
        for (const ocrContext of [false, true]) {
          const box = app.getByLabel(/give redacted OCR text/);
          if ((await box.isChecked()) !== ocrContext) await box.click();
          for (let i = 1; i <= n; i++) {
            const outBefore = outbound.length;
            const reqBefore = allReqs.length;
            await app.getByRole("button", { name: "Extract (on-device)" }).click();
            await app.waitForFunction(
              () => JSON.parse(document.querySelector('[data-testid="metrics"]').dataset.metrics || "{}").totalMs !== undefined,
              null,
              { timeout: 180000 },
            );
            const metrics = JSON.parse(await app.getAttribute('[data-testid="metrics"]', "data-metrics"));
            // textContent: JSON ada di <details> yang tertutup → innerText kosong.
            const json = ((await app.locator('[data-testid="result-json"]').textContent()) ?? "").trim();
            const redacted = await app.locator('[data-testid="redacted-text"]').innerText().catch(() => "");
            const err = await app.locator("[role=alert]").allInnerTexts();
            const r = json.startsWith("{") ? { ok: true, text: json } : { ok: false, error: err.join(" | ") || "tanpa hasil" };
            const score = scoreRun(truth, r);
            const rec = {
              fixture,
              ocrContext,
              run: i,
              at: new Date().toISOString(),
              metrics,
              ok: r.ok,
              error: r.error,
              score: score.summary,
              redactedTextLeaks: piiLeaks(truth, redacted).map((p) => p.kind),
              // Request selama ekstraksi: keluar localhost (harus 0) dan path non-localhost/CDN tesseract (harus kosong).
              outboundDuringExtract: outbound.length - outBefore,
              requestsDuringExtract: allReqs.slice(reqBefore).map((u) => new URL(u).host + new URL(u).pathname.replace(/[^/]+$/, "")),
              badge: (await app.locator('[data-testid="cloud-badge"]').innerText()).trim(),
            };
            runs.push(rec);
            console.log(JSON.stringify({ fixture, ocrContext, run: i, ...metrics, ok: r.ok, err: r.error, acc: rec.score.fieldAcc, pii: rec.score.piiKindRecall, leaks: rec.score.piiLeaks, redactedLeaks: rec.redactedTextLeaks, outbound: rec.outboundDuringExtract, reqs: [...new Set(rec.requestsDuringExtract)], badge: rec.badge }));
          }
        }
        const before = outbound.length;
        // Event routing "explain" (ok/gagal/diblokir) menandai panggilan selesai; tunggu sebentar lagi untuk retry SDK.
        const nExplain = await app.locator('li[data-step="explain"]').count();
        await app.getByRole("button", { name: "Explain (cloud)" }).click();
        await app
          .waitForFunction((k) => document.querySelectorAll('li[data-step="explain"]').length > k, nExplain, { timeout: 60000 })
          .catch(() => {});
        await sleep(3000);
        console.log("explain:", (await app.locator('li[data-step="explain"]').last().innerText().catch(() => "?")).trim());
        console.log("badge:", (await app.locator('[data-testid="cloud-badge"]').innerText()).trim());
        const explainReqs = outbound.slice(before);
        const explainLeaks = explainReqs.flatMap((q) => piiLeaks(truth, q.body).map((p) => p.kind));
        console.log(JSON.stringify({ fixture, explainRequests: explainReqs.map((q) => `${q.method} ${new URL(q.url).host}${new URL(q.url).pathname} ${q.body.length}B`), explainLeaks }));
        runs.push({ fixture, explain: true, requests: explainReqs.length, bodyBytes: explainReqs.map((q) => q.body.length), leaks: explainLeaks });
      }
      const images = await Promise.all(["a-id-hematologi.png", "b-us-lipid.png", "c-id-hematologi-foto.jpeg"].map((f) => readFile(join(ROOT, "fixtures", f))));
      const network = {
        outboundRequests: outbound.length,
        hosts: [...new Set(outbound.map((q) => new URL(q.url).host))],
        maxBodyBytes: Math.max(0, ...outbound.map((q) => q.body.length)),
        bodiesWithImage: outbound.filter((q) => images.some((b) => q.body.includes(b.toString("base64").slice(0, 200)))).length,
        tesseractAssetHosts: [...new Set(allReqs.filter((u) => /tesseract|traineddata/i.test(u)).map((u) => new URL(u).host))],
        cspViolations,
      };
      console.log(JSON.stringify({ network }));
      await writeFile(join(ROOT, "results-app.json"), JSON.stringify({ version, at: new Date().toISOString(), appUrl, runs, network }, null, 2) + "\n");
      console.log("tulis spike/results-app.json");
      return;
    }

    if (mode === "run") {
      if (info.availability !== "available") throw new Error(`Model belum tersedia: ${info.availability}`);
      const n = Number(nArg ?? 3);
      const fixtures = (await readdir(join(ROOT, "fixtures"))).filter((f) => f.endsWith(".truth.json")).sort();
      const runs = [];
      const plan = [];
      for (const tf of fixtures) for (let i = 1; i <= n; i++) plan.push({ tf, i, lang: "id" });
      for (const tf of fixtures) plan.push({ tf, i: 1, lang: "en" });
      for (const { tf, i, lang } of plan) {
        const truth = JSON.parse(await readFile(join(ROOT, "fixtures", tf), "utf8"));
        const prompt = lang === "en" ? EXTRACT_PROMPT_EN : EXTRACT_PROMPT;
        const r = await page.evaluate(([u, p]) => window.nanoExtract(u, p), [`${origin}/fixtures/${truth.image}`, prompt]);
        const score = scoreRun(truth, r);
        const rec = { fixture: tf.replace(".truth.json", ""), run: i, promptLang: lang, ...r, score };
        runs.push(rec);
        console.log(JSON.stringify({ fixture: rec.fixture, run: i, lang, ok: r.ok, totalMs: r.totalMs, promptMs: r.promptMs, ...score.summary }));
      }
      await writeFile(join(ROOT, "results.json"), JSON.stringify({ version, info, at: new Date().toISOString(), runs }, null, 2) + "\n");
      console.log("tulis spike/results.json");
    }
  } finally {
    await browser.close().catch(() => {});
    proc.kill();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
