# LabLens

Penjelas hasil lab privat — hackathon #BuildHybridAI 2026 (Firebase AI Logic hybrid inference).

Alur: foto hasil lab (JPEG/PNG) → ekstraksi + masking PII **on-device** (Gemini Nano di Chrome) → hanya data anonim ke **cloud** Gemini untuk penjelasan bahasa awam. Panel *Routing transparency* menampilkan lokasi inferensi + latensi.

## Prasyarat

- Node 20+, pnpm.
- **Chrome Desktop 139+** dengan Prompt API / Gemini Nano:
  - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled (input gambar).
  - `chrome://flags/#optimization-guide-on-device-model` → Enabled.
  - Cek `chrome://on-device-internals` — model harus sudah terunduh (butuh ruang disk & spesifikasi hardware sesuai syarat Chrome).
- Batasan on-device web: single-turn, input teks + gambar (JPEG/PNG), output teks / structured output.
- Proyek Firebase:
  - **Firebase AI Logic** aktif (Gemini Developer API).
  - Web app terdaftar (ambil config).
  - **App Check** dengan provider reCAPTCHA Enterprise — v3 sudah deprecated untuk App Check; key via `gcloud recaptcha keys create --web --integration-type=score`, tanpa billing (enforcement ditunda). Untuk dev, daftarkan debug token.

## Setup

```bash
cp .env.example .env.local   # isi config Firebase + site key
pnpm install
pnpm dev                     # http://localhost:3000
```

Tanpa `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN`, SDK mencetak debug token di console browser saat dev → daftarkan di Firebase Console → App Check → Manage debug tokens.

### OCR lokal (masking PII deterministik)

OCR memakai `tesseract.js` (WASM, Web Worker) dengan bahasa `ind`+`eng`. Semua aset di-host sendiri di `public/tesseract/`
(tidak ada CDN; folder ini di-`.gitignore`) dan disalin dari `node_modules` oleh `scripts/setup-ocr.mjs`:

- `worker.min.js` ← `tesseract.js/dist/`
- `core/tesseract-core*-lstm.wasm.js` ← `tesseract.js-core/`
- `lang/{ind,eng}.traineddata.gz` ← `@tesseract.js-data/{ind,eng}/4.0.0_best_int/`

Skrip ini jalan otomatis di `postinstall`; jalankan manual dengan `pnpm ocr:assets` bila folder hilang.
`pnpm ocr:fixtures` membuat ulang teks OCR fixture untuk test (`src/lib/pii/`).

## Struktur

- `src/lib/firebase.ts` — init Firebase + App Check (client-only).
- `src/lib/ai/models.ts` — model on-device (`ONLY_ON_DEVICE`/`PREFER_ON_DEVICE`) dan cloud (`ONLY_IN_CLOUD`).
- `src/lib/ai/schemas.ts` — skema hasil lab + PII tersamarkan (Schema cloud + JSON Schema `responseConstraint` on-device).
- `src/lib/ai/router.ts` — `extractOnDevice`, `explainInCloud`, log routing.
- `src/app/page.tsx` — halaman spike.
- `docs/` — PRD & catatan.

## Skrip

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm test` · `pnpm ocr:assets` · `pnpm ocr:fixtures`
