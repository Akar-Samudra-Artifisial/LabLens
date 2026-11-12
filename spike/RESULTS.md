# Spike — Gemini Nano (Chrome Prompt API) untuk ekstraksi hasil lab + masking PII

Run nyata: 2026-11-09 19:15 UTC · Google Chrome 156.0.8078.79 (macOS, Apple Silicon) · profil terpisah `spike/.chrome-profile`
Model diunduh lewat `LanguageModel.create()` (±8 menit). Data mentah: `spike/results.json`. Tabel dibuat dengan `node spike/report.mjs`.

Metode: prompt & JSON Schema **identik** dengan `extractOnDevice` (`src/lib/ai/router.ts:44-47`, `src/lib/ai/schemas.ts:65-95`, disalin ke `spike/shared.mjs`).
Pemanggilan meniru `@firebase/ai` 3.0.0 (`ChromeAdapterImpl`): sesi baru per request, `expectedInputs` text+image, gambar → `ImageBitmap`,
`session.prompt([...], { responseConstraint })`. Tiap fixture 3× dengan prompt ID asli + 1× dengan prompt versi Inggris.

Fixture (semua fiktif, `spike/fixtures/`, generator `make-fixtures.mjs`):
- **a** `a-id-hematologi.png` — klinik Indonesia, 14 baris hematologi (9 abnormal), PII: nama, NIK, RM, tgl lahir, alamat, telp, dokter.
- **b** `b-us-lipid.png` — lab gaya US, lipid panel + HbA1c + glukosa puasa (8 baris), PII: nama, MRN, DOB, alamat, telp, dokter.
- **c** `c-id-hematologi-foto.jpeg` — fixture a dirotasi 5°, blur, kontras rendah, JPEG q62 (simulasi foto HP).

Skor: akurasi field = field benar / (baris truth × 5 field: nama, nilai, unit, rentang, flag). Nama tes dicocokkan
identik / himpunan kata / substring; nilai dibandingkan numerik (`13.800` = `13800`). PII kind recall = jenis PII (tanpa `other`)
yang muncul di `maskedPii`. "PII bocor" = teks PII asli muncul di mana pun di output (termasuk di field `placeholder`).

## Per run

| Fixture | Run | Prompt | JSON valid | Baris (out/truth/match) | Akurasi field | nama/nilai/unit/rentang/flag | PII kind recall | PII bocor | create ms | prompt ms | total ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| a-id-hematologi | 1 (cold) | id | ya | 14/14/14 | 96% | 100% / 100% / 100% / 100% / 79% | 100% | – | 13078 | 43477 | 56570 |
| a-id-hematologi | 2 | id | ya | 14/14/14 | 94% | 100% / 100% / 100% / 100% / 71% | 100% | – | 32 | 24182 | 24388 |
| a-id-hematologi | 3 | id | ya | 14/14/14 | 94% | 100% / 100% / 100% / 100% / 71% | 50% | nik | 53 | 37204 | 37574 |
| b-us-lipid | 1 | id | TIDAK (QuotaExceededError: The response exceeded output limits and was truncated.) | – | – | – | – | – | – | – | 387244 |
| b-us-lipid | 2 | id | ya | 8/8/7 | 85% | 88% / 88% / 88% / 88% / 75% | 100% | name, medical_record_number, date_of_birth, address, phone | 47 | 18137 | 18339 |
| b-us-lipid | 3 | id | ya | 8/8/7 | 83% | 88% / 88% / 88% / 75% / 75% | 100% | – | 25 | 22893 | 23037 |
| c-id-hematologi-foto | 1 | id | TIDAK (QuotaExceededError: sama) | – | – | – | – | – | – | – | 333999 |
| c-id-hematologi-foto | 2 | id | ya | 14/14/13 | 61% | 93% / 93% / 43% / 7% / 71% | 17% | – | 28 | 23794 | 23961 |
| c-id-hematologi-foto | 3 | id | ya | 1/14/1 | 6% | 7% / 7% / 7% / 7% / 0% | 17% | – | 21 | 4015 | 4141 |
| a-id-hematologi | 1 | en | ya | 14/14/14 | 89% | 100% / 100% / 100% / 100% / 43% | 17% | – | 2 | 22212 | 22240 |
| b-us-lipid | 1 | en | ya | 8/8/7 | 83% | 88% / 88% / 88% / 75% / 75% | 20% | – | 4 | 13225 | 13273 |
| c-id-hematologi-foto | 1 | en | ya | 14/14/13 | 59% | 93% / 86% / 21% / 21% / 71% | 100% | – | 35 | 20487 | 20689 |

## Rata-rata

| Fixture | Prompt | n | JSON valid | Akurasi field (run valid) | PII kind recall | Run dgn PII bocor | Latensi run sukses |
|---|---|---|---|---|---|---|---|
| a (bersih, ID) | id | 3 | 3/3 | 95% | 83% | 1/3 | 24–57 s |
| b (bersih, US) | id | 3 | 2/3 | 84% | 100% | 1/2 | 18–23 s |
| c (foto, ID) | id | 3 | 2/3 | 34% | 17% | 0/2 | 4–24 s |
| a | en | 1 | 1/1 | 89% | 17% | 0/1 | 22 s |
| b | en | 1 | 1/1 | 83% | 20% | 0/1 | 13 s |
| c | en | 1 | 1/1 | 59% | 100% | 0/1 | 21 s |

Keseluruhan prompt ID (9 run): **JSON valid 7/9**, akurasi field rata² **74%** (run valid), PII kind recall **69%**, **2/7 run membocorkan PII asli**.
Latensi: cold 56,6 s (create sesi pertama 13,1 s); warm sukses median ±23,5 s (4,1–37,6 s); 2 run gagal baru berhenti setelah **334–387 s**.

## Error khas

1. **Output degeneratif → `QuotaExceededError` setelah ~6 menit** (2/9 run, b & c). Tanpa batas waktu dari app, pengguna menunggu 6 menit lalu gagal.
2. **Flag tidak dibaca dari kolom H/L**: Hb 10.2 (rujukan 12–16, flag "L") → `normal`; Limfosit, Hematokrit, Neutrofil sama. Flag akurasi 71–79% di gambar bersih, 43% dengan prompt EN. VLDL 38 (5–40) → `high`.
3. **Baris tergeser pada foto miring** (c): nilai benar tapi unit & rentang diambil dari baris atas/bawah (Leukosit dapat `g/dL` + `4.0 - 5.2`) → rentang benar hanya 7–21%. Satu run hanya mengembalikan 1 dari 14 baris.
4. **Masking via placeholder tidak bisa diandalkan**: model menaruh nilai PII asli ke `placeholder` (b run 2: nama, MRN, DOB, alamat, telp; a run 3: NIK `3273015408910002`) dan salah jenis (MRN dilabeli `nik`). Recall jenis PII tidak konsisten antar run (17–100%).
5. **OCR halus**: "Hemoglobin A1c" → "Hemoglobin Alc" di semua run b (dihitung tidak cocok oleh scorer; nilainya sendiri benar).
6. Prompt EN tidak lebih baik: akurasi setara/lebih rendah, recall PII turun ke 17–20% di a/b (naik di c — variansi tinggi, n=1).

## Rekomendasi: **layak dengan mitigasi** (bukan sebagai satu-satunya jalur)

Pada gambar bersih, Nano membaca nama tes, nilai, unit, dan rentang dengan sangat baik (≈100% di a, 88% di b) — cukup untuk alur utama
**bila** dibatasi. Pada foto HP realistis (c) dan untuk keamanan PII, Nano saja tidak memadai.

1. **Jangan andalkan model untuk masking PII.** Skema saat ini tidak memisahkan PII dari hasil; model justru menyalin PII ke `placeholder`.
   Ubah desain: ekstraksi hanya meminta `results` (tanpa header pasien), lalu sanitasi deterministik lokal pada output
   (regex NIK 16 digit, tanggal, telp, no RM + daftar label header) sebelum apa pun dikirim ke cloud. Masking tetap lokal.
2. **Hitung flag secara deterministik** dari `value` vs `referenceRange` (parse angka, `<`/`>`) — jangan percaya flag model.
3. **Timeout + retry**: `AbortController` ±45 s per prompt, retry 1× (run gagal → sukses di run berikutnya), lalu fallback.
4. **Fallback cloud untuk ekstraksi** gambar yang gagal/kualitas rendah — hanya setelah crop/redaksi area header di perangkat,
   atau minta konfirmasi eksplisit pengguna. Validasi hasil (jumlah baris < 3, unit/rentang tidak masuk akal) sebagai pemicu fallback.
5. **Pra-proses foto**: deskew/kontras (canvas) sebelum dikirim, dan/atau pecah jadi 2 tahap (tahap 1: transkripsi tabel teks;
   tahap 2: teks → JSON) — belum diuji di spike ini.
6. **Layar review wajib** sebelum penjelasan: pengguna mengoreksi tabel hasil ekstraksi.
7. Pertahankan prompt Bahasa Indonesia.

Batasan spike: 3 fixture sintetis, n=3 (+1 EN), satu mesin; foto HP asli bisa lebih buruk dari simulasi (c).
Belum diuji: pra-proses, pemecahan 2 prompt, perangkat dengan RAM/GPU lebih kecil.

## Optimasi latensi (2026-11-10)

Chrome 157.0.8103.40, profil spike yang sama. Runner `node spike/run-nano.mjs opt <varian> 3` (fixture a & c, 3 run per fixture,
data mentah `spike/results-opt.json`). Semua varian pakai `promptStreaming` untuk memisahkan tahap; batas 120 s (base) agar run degeneratif tidak 6 menit.

**Diagnosis jalur app (sebelum)** — `@firebase/ai` 3.0.0 `ChromeAdapterImpl.generateContent` memanggil `LanguageModel.create()` per request,
dan app membuat `getGenerativeModel()` baru tiap klik; tidak ada `signal` per request untuk on-device (tidak bisa timeout/batal).

| Tahap (varian base, ms) | a run 1 (cold) | warm (a2, a3, c1, c3) |
|---|---|---|
| decode gambar | 171 | 196–1077 |
| create sesi | **15 828** | 35–213 |
| prefill (gambar+prompt → chunk pertama) | 7 120 | 2 726–15 410 (median 6 826) |
| generate output (1,6–1,8 rb char) | 26 567 | 22 481–35 373 (median 25 882) |

Penyebab utama: **generate output ±70–80% waktu**, lalu **create sesi cold 15,8 s** di klik pertama, lalu prefill yang bervariasi (s/d 15 s) di gambar resolusi penuh.
1/3 run c degeneratif (7 985 char saat dipotong 120 s).

**Perubahan app** (`src/lib/ai/prompt-api.ts`, `router.ts`, `schemas.ts`, `page.tsx`): Prompt API langsung (SDK tak memberi kontrol sesi/abort);
sesi dasar dibuat saat halaman dimuat (status `available`) lalu `clone()` per request; gambar → `ImageBitmap` sisi panjang ≤1024 (tanpa re-encode);
schema ramping (tanpa `flag` → dihitung deterministik dari rentang; tanpa `placeholder` → hanya `piiKinds`, placeholder diisi kode), dipetakan ke `LabExtraction` yang sama;
timeout 60 s + batas 6 000 char + tombol Batal; UI timer + tahap; log routing menampilkan ms per tahap.

| Varian | Fixture | Valid | Akurasi field | PII kind recall | Run bocor PII | Total ms | Prefill ms | Generate ms |
|---|---|---|---|---|---|---|---|---|
| base | a | 3/3 | 93,8% | 72% | 1/3 | 49 686 (cold), 45 309, 31 766 | 7 120–15 410 | 22 481–29 136 |
| base | c | 2/3 | 65,7% | 67% | 0/2 | 25 585, **120 264 (timeout)**, 41 529 | 2 726–5 038 | 22 628–35 373 |
| base-1024 | a | 3/3 | 93,8% | 72% | 0/3 | 44 633, 45 103, 44 359 | 2 298–10 352 | 27 290–42 443 |
| base-1024 | c | 2/3 | 60,7% | 100% | 1/2 | 38 577, **120 055 (timeout)**, 39 061 | 3 260–6 052 | 32 709–34 873 |
| **app** | a | 3/3 | **95,3%** | 44% | 0/3 | 28 601, 29 892, 29 027 | 2 551–3 025 | 25 444–27 077 |
| **app** | c | 3/3 | 58,1% | 61% | 0/3 | 33 742, 22 847, 27 850 | 1 930–2 616 | 20 702–30 885 |
| tsv (regex constraint) | a, c | 0/6 | – | – | – | semua timeout 60 s | – | – |

Ringkas: **warm median 36,6 s → 28,8 s** (run sukses; base n=4, app n=6), klik pertama 49,7 s → ±29 s (warm-up 11,5–13,5 s pindah ke saat halaman dimuat),
prefill median 6,8 s → 2,6 s dan stabil. Generate tetap ±25 s: output lebih pendek 25% (char) tapi waktu generate hampir sama → batas bawah = kecepatan decode Nano.
Run degeneratif kini berhenti di 60 s (terverifikasi di app: c gagal "Ekstraksi melebihi 60 s" pada 60 010 ms), bukan 334–387 s.
Di app (localhost:3000, profil spike): fixture a 24,3 / 19,5 / 20,2 s.

Catatan: downscale saja tidak menurunkan total (generate dominan). PII kind recall a turun (72% → 44%) karena model tidak lagi diminta
menulis placeholder — jenis PII dari model memang tidak andal (lihat rekomendasi 1); kebocoran PII 0/6. Constraint RegExp (format teks `a | b | c | d`)
sangat lambat (≤2,7 rb char dalam 60 s) — jangan dipakai. Variansi tinggi (n=3, satu mesin).

## Masking & Streaming (2026-11-10)

Chrome 157.0.8103.40, profil spike, **app nyata** (`localhost:3000`, dev server). Runner `node spike/run-nano.mjs app 3`
(data mentah `spike/results-app.json`): fixture a & c, 3 run tanpa + 3 run dengan teks OCR tersensor sebagai konteks Nano.
Waktu diukur sejak klik "Ekstrak": OCR+sensor = teks/gambar tersensor tampil; baris pertama = baris hasil Nano pertama tampil (streaming).

Pipeline: `tesseract.js` 7 (WASM, worker, ind+eng, PSM 3 + `rotateAuto`, aset lokal `/tesseract/`) → aturan regex/label/zona header
(`src/lib/pii/`) → kotak hitam di canvas + teks placeholder. Paralel: Nano `promptStreaming` + `responseConstraint`, JSON parsial diparse
per objek baris. PII akhir = aturan lokal ∪ `piiKinds` Nano. `assertNoPii` memeriksa payload cloud (pola + nilai PII dokumen ini).

| Fixture | Konteks OCR ke Nano | OCR+sensor | Baris pertama | Total | Akurasi field | PII kind recall (gabungan) | PII bocor (hasil / teks tersensor) |
|---|---|---|---|---|---|---|---|
| a | tidak | 1,4–1,9 s (med 1,7) | **3,0–4,4 s (med 3,9)** | 17,5 / 18,9 / 22,6 s | 90,9% | **100%** (3/3) | 0 / 0 |
| a | ya | 1,3–1,8 s | 6,1–8,3 s (med 6,8) | 23,5 / 32,4 / 40,1 s | 95,7% | 100% | 0 / 0 |
| c | tidak | 2,0–5,4 s (med 2,4) | **4,6–7,5 s (med 5,1)** | 32,5 / 31,5 / 29,9 s | 60,0% | **100%** | 0 / 0 |
| c | ya | 2,1–4,4 s | 6,6–9,0 s (med 8,1) | 34,2 / 8,2 (1 baris, degeneratif) / 30,1 s | 39,1% (57,1% tanpa run degeneratif) | 100% | 0 / 0 |

- **Kesan lambat**: teks + gambar tersensor tampil di ±1,7 s (a) / ±2,4 s (c); baris hasil pertama di **3,9 s** (a) / 5,1 s (c),
  dibanding sebelumnya menunggu total **28,8 s** tanpa umpan balik. Total a (tanpa konteks) median 18,9 s.
- **PII**: recall jenis PII gabungan 100% di semua 12 run (Nano saja: 44% di bagian sebelumnya). Unit test aturan: recall nilai PII
  fixture a & b 100%, c 7/7 tertutup (`pnpm test`, teks OCR nyata). 0 run membocorkan PII asli di hasil maupun teks tersensor.
- **Akurasi a tanpa konteks 90,9% vs 95,3%** (varian `app` di atas, n=3): 1 baris per run diberi nama berbeda (13/14 cocok + 1 baris ekstra);
  prompt & schema identik → variansi Nano, bukan efek perubahan ini. Turun 4,4 poin (< batas 5).
- **Konteks OCR ke Nano**: menaikkan akurasi a (95,7%, nama/nilai/rentang/flag 100%) tetapi baris pertama +3 s (Nano menunggu OCR) dan
  total lebih lama & bervariasi; di c (foto miring) tidak membantu (rentang tetap 7–21%) dan 1/3 run degeneratif. **Default: mati**
  (checkbox eksperimen di UI).
- **Jaringan** (semua request non-localhost dicegat & di-abort oleh runner, lalu diperiksa): selama 12 ekstraksi **0 request keluar**
  (OCR & Nano sepenuhnya lokal, aset OCR dari `localhost`). "Jelaskan (cloud)" = 1 POST `firebasevertexai.googleapis.com` per fixture,
  body 1 762 / 1 741 B, tanpa gambar dan tanpa teks PII asli (dicek dengan `piiLeaks` dari `score.mjs`).

Batasan: n=3 per sel, satu mesin; c tetap lemah di unit/rentang (baris tergeser, masalah Nano — bukan masking).

### Hardening putaran 1 (2026-11-10)

Payload cloud sekarang melewati allowlist per field (`src/lib/pii/allowlist.ts`): nama tes → nama kanonik kamus, baris dengan nama
tak dikenal tidak dikirim; nilai/satuan/rentang berpola. Batas tabel tak ditemukan → cloud dikunci (fail-closed), area kaki disensor.
CSP aktif (`next.config.ts`), worker tesseract dari `/tesseract/worker.min.js` (tanpa blob:/CDN).
`node spike/run-nano.mjs app 2`:

| Fixture | Konteks OCR | OCR+sensor | Baris pertama | Total | Akurasi | PII recall | Bocor |
|---|---|---|---|---|---|---|---|
| a | tidak | 1,6 / 1,3 s | 3,6 / 3,0 s | 20,1 / 19,9 s | 92,9 / 90,0% | 100% | 0 |
| a | ya | 1,3 / 1,3 s | 5,7 / 6,7 s | 22,2 / 29,4 s | 97,1 / 98,6% | 100% | 0 |
| c | tidak | 1,6 / 1,5 s | 3,5 / 2,9 s | 19,7 / 20,0 s | 62,9 / 61,4% | 100% | 0 |
| c | ya | 1,4 / 1,7 s | 5,9 / 6,2 s | 23,6 / 24,4 s | 51,4 / 48,6% | 100% | 0 |

Jaringan: 0 request (lokal maupun keluar) selama 8 ekstraksi; aset tesseract hanya dari `localhost:3000`; 0 pelanggaran CSP.
Explain: 14/14 baris lolos allowlist + guard per fixture, 1 POST `firebasevertexai.googleapis.com` (1 747 / 1 739 B), 0 PII asli.

### Hardening putaran 2 (2026-11-10)

Batas digit per field (value bulat ≤6/desimal ≤3; rentang per sisi ≤5/≤3, total ≤12), tolak bentuk tanggal/telepon, maks. 60
baris, NIK/HP terpecah lintas baris → payload ditolak. Regresi diperbaiki: legenda zona kaki fixture b ("H = High") memblokir payload.
`node spike/run-nano.mjs app 1` (dev, a/b/c) + 1 run di build prod (`next start -p 3100`, CSP tanpa `'unsafe-eval'`):

| Fixture | OCR+sensor | Baris pertama | Akurasi (tanpa / dengan konteks OCR) | PII recall | Bocor | Explain |
|---|---|---|---|---|---|---|
| a | 1,7 s | 3,8 s | 92,9 / 97,1% | 100% | 0 | 14 baris, 1 743 B, 0 PII |
| b | 1,2 s | 3,2 s | 95,0 / 67,5% | 100% | 0 | 8 baris, 1 095 B, 0 PII |
| c | 1,7 s | 3,9 s | 61,4 / 2,9% (1 baris, degeneratif) | 100% | 0 | 1 baris, 286 B, 0 PII |

0 request selama ekstraksi, aset tesseract hanya localhost, 0 pelanggaran CSP (dev & prod).

## Reproduksi

```bash
node spike/fixtures/make-fixtures.mjs   # render fixture + truth
node spike/run-nano.mjs probe           # availability()
node spike/run-nano.mjs download        # sekali, ±8 menit
node spike/run-nano.mjs run 3           # tulis spike/results.json (±18 menit)
node spike/report.mjs                   # tabel markdown
node spike/run-nano.mjs app 3           # app nyata di localhost:3000 (pnpm dev) → spike/results-app.json
```
