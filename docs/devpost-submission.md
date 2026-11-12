# Devpost submission draft — LabLens (#BuildHybridAI 2026)

> Draft for the Devpost form. Fields in **bold** match Devpost field names. Replace the `TODO` placeholders before submitting.

**Project name:** LabLens

**Elevator pitch** (≤200 characters):

> Understand your lab results without giving away your identity. LabLens reads and masks your report on-device with Gemini Nano; only anonymous test rows reach the cloud.

**Category:** Best Web/Chrome

**Video demo URL:** `TODO: YouTube/Vimeo link (≤3 minutes)`

---

## About the project

### Inspiration

Lab reports are hard to read. Most people just want to know which numbers are out of range and what to ask their doctor. Pasting a photo of the report into a cloud chatbot is the easy option, but the same sheet also shows your full name, national ID number, medical record number, date of birth, address and phone number. We wanted the convenience of a large cloud model without sending that identity data anywhere. Hybrid inference lets us split the work: the device reads the document, and the cloud only sees anonymous numbers.

### What it does

LabLens turns a photo of a lab report into a plain-language explanation, and keeps the identity data on the device.

1. **Upload or Try sample.** Upload a JPEG/PNG, or load a synthetic sample (Indonesian hematology or US lipid panel; fictitious patients).
2. **Read & mask on the device.** Local OCR (tesseract.js) plus deterministic PII detection masks the national ID (NIK), medical record number, dates, phone numbers, addresses, labelled names, and the report header/footer zones. If those zones cannot be found, cloud sending is locked (fail-closed). You see the redacted image and the masked text.
3. **Extract the results table.**
   - With **Gemini Nano** in Chrome, extraction runs fully on-device, and rows stream into the table as they are generated. No document data leaves the device.
   - Without Gemini Nano, LabLens offers **private cloud extraction**, and only after you click to consent. It sends only the masked, result-shaped lines that pass a per-line allowlist; unknown test names become `Test N` and are mapped back locally. It never sends the image, header or footer.
4. **Flags computed locally.** Low / high / normal comes from each row's reference range, computed in code rather than by the model.
5. **Explain in plain language (cloud).** Gemini explains the anonymous rows in English or Bahasa Indonesia: a summary, a note per test, and 3–6 questions to ask your doctor. The medical disclaimer is fixed text in the code.

Two features make the routing visible. The **Routing transparency** panel shows each step's location (on-device or cloud), latency, bytes sent, and PII found on the device vs. PII sent to the cloud. The **Payload Inspector** shows the exact text that will be sent and what was sent.

### How we built it

- **Next.js 16** static export on **Firebase Hosting**, with React 19, TypeScript and Tailwind CSS 4.
- **Firebase AI Logic** (`firebase/ai`) for all AI inference:
  - `getAI(app, { backend: new GoogleAIBackend() })`
  - On-device extraction: `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: { promptOptions: { responseConstraint } } })` with `generateContentStream`. A JSON Schema constrains Gemini Nano's output, and a streaming JSON parser renders each row as soon as it is complete. `initializeDeviceModel()` warms the model up when the page loads.
  - Cloud fallback extraction and explanation: `InferenceMode.ONLY_IN_CLOUD` with `gemini-3.5-flash-lite`, `responseMimeType: "application/json"` and a `responseSchema` (`ExplanationResult` for explanations).
- **Firebase App Check** with `ReCaptchaEnterpriseProvider`, enforced for Firebase AI Logic.
- **tesseract.js 7** OCR in a Web Worker with self-hosted WASM and language data (no CDN), under a strict Content Security Policy.
- A deterministic **PII layer** (`src/lib/pii/`): regex and label rules, header/footer zone detection, canvas redaction, a per-field allowlist for cloud payloads, and an `assertNoPii` guard that re-checks every cloud payload against generic patterns and against the PII values found in this document.
- **Vitest** with 133 unit tests, and a **playwright-core spike runner** that drives real Chrome with Gemini Nano against synthetic fixtures with ground truth, to measure accuracy, latency, PII leaks and network traffic.

### Challenges we ran into

- **SDK session lifecycle.** The hybrid SDK creates a new on-device session per call and has no way to abort an on-device request. We cache the model instance, warm it up on page load, and add our own timeout and cancel button. A cancelled Nano run still finishes in the background, which is a known SDK limitation.
- **Gemini Nano latency.** Output generation dominates. Total extraction takes ≈ 20–31 s depending on the machine. A leaner schema (flags computed in code, not by the model) and streaming rows bring the first row to ≈ 3.6–5.2 s, so the user sees progress early.
- **PII in free OCR text.** OCR output is messy: labels and values get split, and numbers look alike. Asking the model to find PII was not reliable enough, so masking is deterministic and fail-closed. Cloud payloads also pass a per-line allowlist and a final guard.
- **App Check provider.** reCAPTCHA v3 is deprecated for App Check, so we moved to reCAPTCHA Enterprise (score-based key) with debug tokens for local development.

### Accomplishments that we're proud of

- On the synthetic fixtures, PII recall is **100% with 0 leaks** (fixtures a, b, c).
- On-device extraction of fixture a produces **14/14 rows**. The private cloud fallback produces **14/14 rows in ≈ 4.6 s**.
- The Explain payload is **≈ 2.2 KB**, with no image and no PII, and you can inspect it before it is sent.
- The privacy story is visible in the UI rather than just stated: the Routing panel and Payload Inspector show exactly what ran where and what left the device.
- The app works in any browser through the fallback, and you can try it without uploading anything personal (Try sample).

### What we learned

- Gemini Nano works well for structured extraction from clean documents, but it should not be the only safeguard for privacy. Deterministic rules plus a guard are more predictable.
- Small on-device models do better with a smaller job: compute what you can in code (flags, placeholders) and keep the schema lean.
- Streaming changes how latency feels, even when the total time stays the same.
- Hybrid AI is not just "on-device or cloud". The useful design question is what data each side needs, and the minimum answer is often much less than the full document.

### What's next

- Better accuracy on rotated or blurred phone photos. Fixture c is ≈ 61% today (deskewing, better table detection).
- A larger dictionary of test names and more report layouts and languages.
- Real cancellation of on-device inference once the SDK supports it.
- Trend view across several reports, stored only on the device.

---

## Built with

`firebase-ai-logic` · `gemini-nano` · `gemini` · `firebase-app-check` · `recaptcha-enterprise` · `firebase-hosting` · `next.js` · `react` · `typescript` · `tailwindcss` · `tesseract.js` · `webassembly` · `vitest` · `playwright`

## Try it out

- Live app: <https://lablens-hybridai-bt.web.app>
- Source code (MIT): <https://github.com/Akar-Samudra-Artifisial/LabLens>

---

## Testing instructions for judges

Access is free, and you don't need an account or your own data.

### A. With Gemini Nano (on-device path)

1. Use **Chrome Desktop 139+** with Gemini Nano (Prompt API) available. To check, open `chrome://on-device-internals`, or look at the LabLens header badge: it should read `Gemini Nano: available`. If it reads `downloadable`, click **Download Gemini Nano & extract on-device** and wait for the download.
2. Open <https://lablens-hybridai-bt.web.app> and click **Try sample (ID hematology)** or **Try sample (US lipid)**.
3. Click **Extract (on-device)**. The redacted image and masked text appear first, then rows stream into the Results table. Expect ≈ 20–31 s in total, depending on the machine.
4. Choose **English** or **Bahasa Indonesia** and click **Explain (cloud)**.

### B. Without Gemini Nano (private cloud fallback)

1. Use any other browser or device, or Chrome without Gemini Nano.
2. Open the live app and click **Try sample**. A notice explains why on-device AI is not ready.
3. Click **Read & mask on device**. OCR and masking still run locally.
4. In the **Private cloud extraction (fallback)** card, open **Show exactly what will be sent**, then click **Extract via private cloud (masked text)**.
5. Click **Explain (cloud)**.

### What to look at in the Routing transparency panel

- **PII found on device** vs. **PII in cloud payloads**: the second number should stay `0`.
- **Sent to cloud**: `0 B` after on-device extraction. Bytes appear only after a cloud step (Explain or the fallback).
- **Timeline**: each step is labelled *On-device (Gemini Nano)* or *Cloud (Gemini)*, with its latency and the bytes that left the device.
- **Inspect cloud payload**: shows the exact text before and after sending. It contains test names, values, units and ranges only, with no names, ID numbers, dates or images.
- Optional: open DevTools → Network during on-device extraction. You will see no AI request to the cloud, only the App Check token exchange (no document data).

**Notes:** the samples are synthetic, with fictitious patients. LabLens is not a diagnostic tool. Photos that are rotated or blurred are less accurate (≈ 61% on our blurred fixture).
