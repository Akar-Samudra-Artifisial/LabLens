# LabLens

**A private lab-report explainer.** Your lab report is read on your device. Only anonymous test rows reach the cloud.

Built for the **#BuildHybridAI 2026** hackathon with **Firebase AI Logic hybrid inference**: Gemini Nano on-device in Chrome, plus Gemini in the cloud.

- **Live demo:** <https://lablens-hybridai-bt.web.app>
- **Repository:** <https://github.com/Akar-Samudra-Artifisial/LabLens>
- **License:** MIT

> LabLens is **not a medical device and does not diagnose**. It explains your numbers in plain language. Only a qualified health professional can interpret your results.

## Screenshots

| On-device extraction + cloud explanation (desktop) | Private cloud fallback without Gemini Nano (desktop) | Explanation (mobile) |
|---|---|---|
| ![On-device extraction and cloud explanation](docs/screenshots/on-device-explain-desktop.png) | ![Private cloud extraction consent](docs/screenshots/cloud-fallback-consent-desktop.png) | ![Explanation on mobile](docs/screenshots/cloud-explain-mobile.png) |

All screenshots use the bundled **synthetic** sample reports (fictitious patients, no real data).

## How it works

```mermaid
flowchart TD
    A["Upload photo (JPEG/PNG)<br/>or Try sample (synthetic)"]

    subgraph DEVICE["On device (browser)"]
        B["Local OCR<br/>tesseract.js, self-hosted assets"]
        C["Deterministic PII detection and masking<br/>ID numbers, MRN, dates, phone, address,<br/>labelled names, report header/footer zones<br/>(fail-closed if zones are not found)"]
        D{"Gemini Nano<br/>available?"}
        E["Structured extraction with Gemini Nano<br/>InferenceMode.ONLY_ON_DEVICE<br/>generateContentStream + JSON Schema<br/>rows stream into the table"]
        F["Prepare private cloud extraction<br/>per-line allowlist of result-shaped rows<br/>unknown test names become Test N, mapped back locally<br/>assertNoPii guard"]
        G["Low / high / normal flags<br/>computed locally from reference ranges"]
        I["Explain payload<br/>allowlisted anonymous rows only<br/>assertNoPii guard"]
        K["Summary, per-test notes,<br/>3–6 questions for your doctor<br/>+ fixed disclaimer from code"]
    end

    subgraph CLOUD["Cloud: Firebase AI Logic, App Check enforced"]
        H["Gemini cloud extraction<br/>InferenceMode.ONLY_IN_CLOUD<br/>responseSchema, masked text only, no image"]
        J["Gemini plain-language explanation (en/id)<br/>structured ExplanationResult"]
    end

    A --> B --> C --> D
    D -- yes --> E --> G
    D -- "no: user clicks to consent" --> F --> H --> G
    G --> I --> J --> K
```

1. **Input** — upload a photo of a lab report, or use **Try sample** (synthetic Indonesian hematology or US lipid report).
2. **Read & mask (on device)** — `tesseract.js` OCR runs in a Web Worker with self-hosted assets (no CDN). Deterministic rules detect and mask identity data: national ID (NIK), medical record number, dates, phone numbers, addresses, labelled names, and the report header/footer zones. If the zones cannot be detected, cloud sending is locked (fail-closed). The image is redacted with black boxes on a canvas.
3. **Extract**
   - **On-device path** — Gemini Nano through the Firebase AI Logic hybrid SDK (`InferenceMode.ONLY_ON_DEVICE`, `generateContentStream`, JSON Schema `responseConstraint`). Rows appear in the table as they stream.
   - **Fallback path** — if Gemini Nano is not available, the user can opt in to **private cloud extraction** with a click. Only result-shaped lines that pass a per-line allowlist are sent: known test names from a dictionary; unknown names are replaced with `Test N` and mapped back locally. No image is sent. The `assertNoPii` guard checks the text again before Gemini in the cloud (`InferenceMode.ONLY_IN_CLOUD`, `gemini-3.5-flash-lite`, `responseSchema`) extracts the rows.
4. **Flag** — low / high / normal is computed locally from each row's reference range, not by the model.
5. **Explain (cloud)** — Gemini in the cloud explains the results in English or Bahasa Indonesia, using only allowlisted anonymous rows. The output is a structured `ExplanationResult`: a summary, notes per test, and 3–6 questions to ask your doctor. The medical disclaimer is fixed text from the code, not generated.

The **Routing transparency** panel shows a timeline of every step: on-device or cloud, latency, bytes sent, and PII found vs. PII sent. The **Payload Inspector** ("Inspect cloud payload") shows the exact text before and after it is sent.

## Privacy model

| Stays on your device | Sent to the cloud (Firebase AI Logic) |
|---|---|
| The original image and the redacted image | Never sent |
| Full OCR text, including the report header/footer | Never sent |
| Detected identity data (names, ID numbers, MRN, dates, phone, address, doctor) | Never sent; every cloud payload is checked by `assertNoPii` |
| On-device extraction with Gemini Nano | No document data leaves the device during on-device extraction |
| — | **Fallback extraction (only after you click to consent):** masked, allowlisted result lines as text; unknown test names as `Test N` |
| — | **Explain:** allowlisted anonymous rows (test name, value, unit, reference range, flag) |

During on-device extraction, the only network traffic is the App Check token exchange, which carries no document data. All AI inference goes through Firebase AI Logic. App Check (reCAPTCHA Enterprise) is enforced, and the site runs with a strict Content Security Policy (`next.config.ts`).

## Requirements

**For the on-device path:**

- **Chrome Desktop 139+** with **Gemini Nano (Prompt API)** available. Chrome's own hardware and disk-space requirements for Gemini Nano apply.
- Check the status in the LabLens header badge (`Gemini Nano: available` / `downloadable` / `unavailable`), or open `chrome://on-device-internals`.
- If the model is `downloadable`, LabLens offers a **Download Gemini Nano & extract on-device** button.

**Everything else** (other browsers, mobile, or Chrome without Gemini Nano) uses the **private cloud fallback**. OCR and PII masking still run on the device. Only the masked results-table text is sent, after your consent.

## Quick start

Prerequisites: Node 20+, pnpm (the repo pins `pnpm@11.7.0` via `packageManager`).

```bash
cp .env.example .env.local   # fill in Firebase config + reCAPTCHA Enterprise site key
pnpm install                 # postinstall copies the OCR assets to public/tesseract/
pnpm dev                     # http://localhost:3000
```

### Firebase setup (summary)

1. Create a Firebase project and enable **Firebase AI Logic** with the **Gemini Developer API** backend.
2. Register a **web app** and copy its config into the `NEXT_PUBLIC_FIREBASE_*` variables in `.env.local`.
3. Set up **App Check** with the **reCAPTCHA Enterprise** provider (reCAPTCHA v3 is deprecated for App Check). Create a score-based web key, for example with `gcloud recaptcha keys create --web --integration-type=score`, then put it in `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.
4. For local development, register a **debug token**. If `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN` is empty, the SDK prints a new debug token in the browser console. Add it under Firebase Console → App Check → Manage debug tokens.
5. Optional: `NEXT_PUBLIC_CLOUD_MODEL` (default `gemini-3.5-flash-lite`).

### Local OCR assets

OCR uses `tesseract.js` (WASM, Web Worker) with the `ind` + `eng` languages. All assets are self-hosted in `public/tesseract/` (git-ignored, no CDN). `scripts/setup-ocr.mjs` copies them from `node_modules`:

- `worker.min.js` ← `tesseract.js/dist/`
- `core/tesseract-core*-lstm.wasm.js` ← `tesseract.js-core/`
- `lang/{ind,eng}.traineddata.gz` ← `@tesseract.js-data/{ind,eng}/4.0.0_best_int/`

This runs automatically on `postinstall`. Run `pnpm ocr:assets` if the folder is missing.

## Testing

```bash
pnpm test        # vitest: 133 unit tests (PII detection/masking, allowlist, guard, fallback text, streaming JSON, router, explanation)
pnpm lint
pnpm build       # static export (Firebase Hosting)
pnpm ocr:fixtures  # regenerate the OCR text fixtures used by the PII tests (src/lib/pii/)
```

**Spike runner** (Gemini Nano in a real Chrome via `playwright-core`, separate profile `spike/.chrome-profile`). Results and method are in [`spike/RESULTS.md`](spike/RESULTS.md):

```bash
node spike/fixtures/make-fixtures.mjs   # render synthetic fixtures + ground truth
node spike/run-nano.mjs probe           # availability()
node spike/run-nano.mjs download        # one-time model download
node spike/run-nano.mjs app 3           # real app on localhost:3000 (run `pnpm dev` first) → spike/results-app.json
```

### Measured results (synthetic fixtures)

| Metric | Result |
|---|---|
| PII recall / leaks (fixtures a, b, c) | 100% recall, 0 leaks |
| On-device extraction, fixture a | 14/14 rows; benchmark runs: first row ≈ 3.6–5.2 s, total ≈ 20–31 s. Live app (timed from the Extract click, so it includes Gemini Nano reading the image): first row ≈ 17 s, total ≈ 36 s. Depends on the machine. |
| Private cloud fallback extraction, fixture a | 14/14 rows in ≈ 4.6 s |
| Explain payload | ≈ 2.2 KB, no image, no PII |
| Rotated/blurred photo (fixture c) accuracy | ≈ 61% (known limitation) |

## Tech stack

- **Next.js 16** (static export), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **Firebase AI Logic** (`firebase/ai`): `getAI` + `GoogleAIBackend`, `getGenerativeModel` with `InferenceMode.ONLY_ON_DEVICE` (Gemini Nano via the Chrome Prompt API) and `InferenceMode.ONLY_IN_CLOUD` (`gemini-3.5-flash-lite`)
- **Firebase App Check** (`ReCaptchaEnterpriseProvider`), **Firebase Hosting**
- **tesseract.js 7** (local OCR, self-hosted WASM)
- **Vitest** (unit tests), **playwright-core** (spike runner)

### Project structure

- `src/lib/firebase.ts` — Firebase + App Check initialisation (client only)
- `src/lib/ai/models.ts` — on-device and cloud models (Firebase AI Logic)
- `src/lib/ai/router.ts` — on-device extraction, private cloud fallback, explanation, routing log
- `src/lib/ai/schemas.ts` — extraction/explanation schemas (cloud `Schema` + on-device JSON Schema)
- `src/lib/ocr/` — tesseract.js wrapper
- `src/lib/pii/` — PII detection, redaction, allowlist, `assertNoPii` guard, fallback text
- `src/components/` — UI, including `RoutingPanel` and `PayloadInspector`
- `docs/` — PRD, Devpost submission draft, screenshots
- `spike/` — Gemini Nano measurements and fixtures

## Limitations

- **Photo quality:** on a rotated, blurred, low-contrast photo (fixture c), extraction accuracy is ≈ 61%. Clean scans and screenshots work best.
- **Gemini Nano latency:** on-device extraction takes ≈ 20–31 s in benchmark runs and up to ≈ 36 s in the live app, depending on the machine. Gemini Nano first reads the image (≈ 15 s in the live app), then rows stream in one by one; the "First row" figure is timed from the Extract click and includes that image read.
- **No real abort for Nano:** a timeout or cancel stops LabLens from waiting, but the model keeps running in the background (SDK limitation).
- **Split record numbers:** a medical record number split into pieces of ≤3 digits across lines cannot be told apart from lab values.
- **Desktop Chrome only for on-device:** other browsers use the private cloud fallback.
- **Not a diagnostic tool.**

## Medical disclaimer

LabLens is an educational tool. It is **not a medical device**, does not provide a diagnosis, and does not replace a doctor. Always discuss your results with a qualified health professional. The sample reports are synthetic and contain fictitious patients.

## License

[MIT](LICENSE) © 2026 Bayu Trisnapati
