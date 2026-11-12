# LabLens — Product Requirements Document (BuildHybridAI 2026)

Nov 10, 2026 · @Bayu Kaktua · Status: Draft

## Ringkasan

LabLens adalah aplikasi web yang menjelaskan hasil lab dengan bahasa awam tanpa mengirim data identitas pengguna ke cloud. Pengguna mengunggah foto hasil lab. **Di perangkat** (Gemini Nano via Chrome Prompt API), LabLens mengekstrak nilai ke JSON dan menyamarkan PII. **Hanya payload anonim** yang dikirim ke Gemini di cloud untuk penjelasan, penandaan nilai abnormal, dan pertanyaan untuk dokter. Hasilnya digabung kembali (rehydrate) secara lokal. Semua dibangun dengan **Firebase AI Logic hybrid inference** untuk hackathon **#BuildHybridAI 2026** (tema: *Build AI apps that run on-device and in the cloud with Firebase AI Logic*).

Antarmuka utama berbahasa Inggris, dengan opsi Bahasa Indonesia. Dokumen ini berbahasa Indonesia mengikuti PRD sebelumnya; teks UI, video, dan submission berbahasa Inggris karena juri internasional.

### Latar belakang

Hasil lab biasanya diterima sebagai lembar angka dengan singkatan (HbA1c, SGPT, LDL) dan rentang rujukan. Banyak orang menunggu janji dokter berhari-hari dengan rasa cemas, atau menempelkan foto hasil lab ke chatbot cloud. Foto itu memuat nama, NIK/ID, nomor rekam medis, tanggal lahir, alamat, dan nama dokter atau fasilitas kesehatan. Itu data kesehatan yang sangat sensitif, dan pengguna jarang sadar ke mana data itu pergi.

Penjelas yang sepenuhnya on-device terlalu lemah untuk penjelasan kualitas baik. Penjelas yang sepenuhnya cloud membocorkan identitas. Hybrid inference membagi pekerjaan: bagian yang menyentuh data mentah dikerjakan di perangkat, bagian yang butuh kecerdasan besar dikerjakan di cloud dengan data yang sudah anonim.

### Pernyataan masalah

> Orang awam tidak punya cara cepat untuk memahami hasil lab mereka tanpa menyerahkan identitas medisnya ke layanan cloud.

### Kenapa sekarang

Firebase AI Logic kini mendukung hybrid inference di web: `getGenerativeModel` dengan `InferenceMode.PREFER_ON_DEVICE`/`ONLY_ON_DEVICE`/`ONLY_IN_CLOUD`, dan Chrome Desktop 139+ menyediakan Prompt API dengan input gambar dan structured output (`responseConstraint`). Untuk pertama kalinya satu SDK memungkinkan dua lokasi inferensi dengan satu API, dan pemisahan ini bisa dibuktikan lewat `response.inferenceSource`.

## Tujuan dan non-tujuan

LabLens berhasil jika pengguna memahami hasil lab dalam hitungan detik, dan terbukti tidak ada PII yang meninggalkan perangkat.

### Tujuan

1. **Privasi yang bisa dibuktikan.** PII diekstrak dan disamarkan di perangkat; cloud hanya menerima nilai tes anonim. Panel *Routing transparency* menampilkan buktinya.
2. **Penjelasan yang berguna.** Setiap nilai dijelaskan dengan bahasa awam, ditandai (low/normal/high/critical), disertai pertanyaan untuk dokter.
3. **Hybrid yang bermakna.** Setiap tugas dialokasikan ke on-device atau cloud dengan alasan teknis yang jelas, bukan sekadar demo.
4. **Tetap berguna saat offline.** Ringkasan dasar tersedia on-device; analisis cloud diantrikan dan dijalankan saat online.
5. **Dua bahasa.** English (utama) dan Bahasa Indonesia.

### Non-tujuan

- **Bukan alat diagnosis.** LabLens tidak mendiagnosis, tidak menyarankan obat, dan tidak menggantikan dokter. Disclaimer tampil di setiap hasil.
- **Bukan penyimpanan rekam medis.** Tidak ada akun, tidak ada penyimpanan server secara default.
- **Bukan dukungan semua perangkat.** Hybrid penuh hanya di Chrome Desktop 139+. Android on-device (masih beta) dan browser lain di luar cakupan.
- **Bukan percakapan multi-turn.** Prompt API on-device di web hanya single-turn.
- **Bukan OCR serbaguna.** Hanya dokumen hasil lab; PDF di luar MVP (hanya JPEG/PNG).

## Persona pengguna

| Persona | Peran dalam LabLens | Kebutuhan utama | Kekhawatiran |
| --- | --- | --- | --- |
| **Maya, pasien awam** (32, karyawan, Jakarta) | Mengunggah foto hasil lab, membaca penjelasan | Memahami angka sebelum bertemu dokter | Fotonya (nama, NIK) bocor atau tersimpan di server asing |
| **Arif, anak dewasa pengurus orang tua** (45) | Mengunggah hasil lab orang tua, menyiapkan pertanyaan untuk dokter | Pertanyaan yang tepat untuk konsultasi singkat | Salah paham lalu panik atau menyepelekan |
| **Dr. Lina, juri/penguji privasi** (persona evaluasi) | Memeriksa klaim privasi | Bukti teknis, bukan janji | Klaim "privat" yang tak terverifikasi |

Maya adalah persona inti MVP. Jika ia tidak percaya data identitasnya aman, ia tidak akan mengunggah apa pun, sehingga transparansi routing menjadi kebutuhan P0.

## Alur pengguna utama

1. Pengguna membuka LabLens; sistem memeriksa dukungan on-device dan status model.
2. Pengguna mengunggah foto hasil lab (JPEG/PNG).
3. **On-device** (`extractOnDevice`): ekstraksi baris tes ke `LabExtraction` dan pendeteksian PII (`maskedPii`).
4. Pengguna meninjau pratinjau: nilai terekstraksi dan PII yang disamarkan (`[NAME]`, `[ID]`, ...). Pengguna bisa mengoreksi nilai.
5. Pengguna menekan "Explain" → **cloud** (`explainInCloud`) menerima hanya `results` anonim.
6. Hasil dipadukan lokal (rehydrate) dan ditampilkan: penjelasan, flag, pertanyaan untuk dokter.
7. Panel *Routing transparency* menunjukkan lokasi tiap langkah, latensi, dan "0 byte PII sent".
8. Jika offline: ringkasan dasar on-device ditampilkan; permintaan cloud diantrikan dan dikirim saat online.

## Arsitektur hybrid

```
┌────────────────────────── Browser (Chrome Desktop 139+) ──────────────────────────┐
│  UI (Next.js, client-only)                                                         │
│   │  foto JPEG/PNG                                                                 │
│   ▼                                                                                │
│  extractOnDevice()  ── getOnDeviceExtractionModel() ── InferenceMode.ONLY_ON_DEVICE│
│   │  Gemini Nano + responseConstraint (labExtractionJsonSchema)                    │
│   ▼                                                                                │
│  LabExtraction { results[], maskedPii[] }   ← PII berhenti di sini                 │
│   │  hanya results[] (anonim)                                                      │
│   ▼                                                                                │
│  Anonymization guard (cek ulang: tak ada pola PII)                                 │
│   │                                     ┌──────────────────────────────┐           │
│   └──── explainInCloud() ─────────────▶ │ Firebase AI Logic + App Check │──▶ Gemini │
│          getCloudExplainModel()         │ ONLY_IN_CLOUD (3.5-flash-lite)│   cloud   │
│          ◀── penjelasan, flag, pertanyaan ◀─────────────────────────────┘           │
│   ▼                                                                                │
│  Rehydrate lokal + Routing log (subscribeRouting → RoutingEvent[])                 │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Tugas → mode inference → alasan

| Tugas | Mode inference | Fungsi di kode | Alasan |
| --- | --- | --- | --- |
| Ekstraksi nilai lab dari gambar ke JSON | `ONLY_ON_DEVICE` (strict) | `getOnDeviceExtractionModel(true)` | Gambar mentah memuat PII; tidak boleh keluar perangkat. Tanpa fallback cloud |
| Identifikasi dan masking PII | `ONLY_ON_DEVICE` | `extractOnDevice` (`maskedPii`) | Sama; langkah ini yang membuat payload cloud anonim |
| Ekstraksi dengan fallback (mode demo/uji) | `PREFER_ON_DEVICE` | `getOnDeviceExtractionModel(false)` | Hanya untuk pengembangan; **dinonaktifkan secara default** karena bisa mengirim gambar ke cloud |
| Penjelasan awam, flag, pertanyaan dokter | `ONLY_IN_CLOUD` | `getCloudExplainModel()` → `explainInCloud` | Butuh penalaran dan kualitas bahasa yang melampaui Gemini Nano; input sudah anonim |
| Ringkasan dasar saat offline | `ONLY_ON_DEVICE` (teks) | (baru) `summarizeOnDevice` | Tetap berguna tanpa jaringan; kualitas lebih rendah dan ditandai demikian |
| Pencatatan routing | Lokal | `record`, `subscribeRouting` | Bukti `inferenceSource` per langkah, tanpa mengirim apa pun |

Catatan teknis (diverifikasi di SDK terpasang `firebase 13.2.0` / `@firebase/ai 3.0.0`, `next 16.4.5`): `responseSchema` tidak diteruskan ke on-device, sehingga on-device memakai `onDeviceParams.promptOptions.responseConstraint` (JSON Schema, `labExtractionJsonSchema`), sedangkan cloud memakai `Schema` (`labExtractionSchema`). Model cloud default `gemini-3.5-flash-lite` (`NEXT_PUBLIC_CLOUD_MODEL` untuk menimpa).

## User stories dan acceptance criteria

| ID | User story | Acceptance criteria |
| --- | --- | --- |
| US-1 | Sebagai pengguna, saya ingin mengunggah foto hasil lab agar angkanya terbaca otomatis | Menerima JPEG/PNG; format lain ditolak dengan pesan jelas; ekstraksi menghasilkan `LabExtraction` valid terhadap `labExtractionJsonSchema` |
| US-2 | Sebagai pengguna, saya ingin identitas saya disamarkan sebelum apa pun dikirim | `maskedPii` memuat jenis (`name`, `nik`, `medical_record_number`, `date_of_birth`, `address`, `phone`, `other`); pratinjau menampilkan placeholder; tidak ada nilai PII asli di `results` |
| US-3 | Sebagai pengguna, saya ingin meninjau dan mengoreksi hasil ekstraksi sebelum dikirim | Setiap baris bisa diedit atau dihapus; tombol "Explain" aktif hanya setelah pengguna meninjau |
| US-4 | Sebagai pengguna, saya ingin penjelasan bahasa awam per nilai | Setiap `LabTestResult` punya penjelasan 1–2 kalimat, flag (`low/normal/high/critical/unknown`), dan arti singkat; tanpa diagnosis |
| US-5 | Sebagai pengguna, saya ingin daftar pertanyaan untuk dokter | 3–6 pertanyaan terkait nilai abnormal; jika semua normal, pertanyaan umum pencegahan |
| US-6 | Sebagai pengguna, saya ingin melihat apa yang diproses di perangkat vs cloud | Panel *Routing transparency* menampilkan tiap `RoutingEvent` (step, `location` dari `inferenceSource`, `latencyMs`, status); indikator "0 byte PII sent" dihitung dari payload cloud |
| US-7 | Sebagai pengguna, saya ingin tetap mendapat sesuatu saat offline | Offline → ringkasan dasar on-device + banner "Cloud analysis queued"; saat online antrean berjalan otomatis; antrean hanya memuat data anonim |
| US-8 | Sebagai pengguna, saya ingin disclaimer medis yang jelas | Banner "Not a medical diagnosis" di setiap hasil dan ekspor; nilai `critical` memunculkan anjuran menghubungi tenaga medis |
| US-9 | Sebagai pengguna, saya ingin berganti bahasa | Toggle EN/ID mengubah UI dan penjelasan; bahasa dikirim sebagai parameter prompt, bukan data pengguna |
| US-10 | Sebagai penguji, saya ingin memverifikasi klaim privasi | Panel menampilkan payload persis yang dikirim ke cloud (bisa dibuka) sebelum dan sesudah pengiriman |
| US-11 | Sebagai pengguna tanpa dukungan on-device, saya ingin tahu kenapa dan apa yang bisa dilakukan | Browser/model tak didukung → layar penjelasan + langkah mengaktifkan; tidak ada fallback cloud untuk gambar |

## Kebutuhan fungsional

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-1 | Deteksi kemampuan: Chrome 139+, ketersediaan Prompt API, status unduhan model (progress ditampilkan) | P0 |
| FR-2 | `extractOnDevice(file)` dengan validasi tipe file dan structured output | P0 |
| FR-3 | Masking PII dan guard anonimisasi sebelum `explainInCloud` (regex NIK 16 digit, tanggal lahir, telepon, nama dari `maskedPii`) | P0 |
| FR-4 | `explainInCloud(results)` hanya menerima `readonly LabTestResult[]` | P0 |
| FR-5 | Log routing (`RoutingEvent`) dan panel transparansi | P0 |
| FR-6 | Rehydrate lokal: placeholder diganti nilai asli di tampilan dan ekspor lokal | P1 |
| FR-7 | Mode offline: ringkasan on-device dan antrean analisis cloud | P1 |
| FR-8 | Bilingual EN/ID | P1 |
| FR-9 | Estimasi biaya hemat dan latensi (dengan rumus yang ditampilkan) | P1 |
| FR-10 | Ekspor ringkasan (print/PDF lokal) | P2 |
| FR-11 | Contoh hasil lab sintetis untuk demo | P0 |

## Kebutuhan non-fungsional

- **Privasi:** tidak ada penyimpanan server; tidak ada analytics yang memuat konten; gambar tidak pernah diunggah.
- **Keamanan:** App Check (reCAPTCHA Enterprise) wajib dan ditegakkan untuk AI Logic (`getFirebaseApp`).
- **Performa:** ekstraksi on-device ≤ 20 dtk untuk satu halaman pada perangkat target; penjelasan cloud ≤ 8 dtk.
- **Aksesibilitas:** kontras WCAG AA, navigasi keyboard, label ARIA di panel routing.
- **Ketahanan:** setiap kegagalan model menghasilkan pesan yang bisa ditindaklanjuti, tidak ada layar kosong.

## Data model dan skema

Semua tipe ada di `src/lib/ai/schemas.ts`.

```ts
type LabFlag  = "low" | "normal" | "high" | "critical" | "unknown";
type PiiKind  = "name" | "nik" | "medical_record_number" | "date_of_birth"
              | "address" | "phone" | "other";

interface LabTestResult { testName; value; unit; referenceRange; flag: LabFlag }
interface MaskedPii     { kind: PiiKind; placeholder: string }       // placeholder mis. "[NAME]"
interface LabExtraction { results: LabTestResult[]; maskedPii: MaskedPii[] }

interface RoutingEvent  {                                            // router.ts
  id; step: "extract" | "explain"; location: InferenceSource | "unknown";
  latencyMs: number; ok: boolean; error?: string; at: number }
```

- Payload cloud = `JSON.stringify(results)` + instruksi bahasa; **tanpa** `maskedPii`.
- Nilai asli PII tidak ada di skema output; dipegang hanya di memori tab untuk rehydrate (bila FR-6 dikerjakan) dan dibuang saat tab ditutup.
- Penambahan yang direncanakan: `ExplanationResult { summary, perTest[], doctorQuestions[], disclaimer }` untuk output cloud (memakai `Schema`), dan `QueuedAnalysis { id, results, createdAt }` untuk antrean offline (IndexedDB, hanya data anonim).
- Nama dokter dan fasilitas kesehatan diperlakukan sebagai PII: dicakup `kind: "other"` di MVP; `PiiKind` khusus `provider` dipertimbangkan bila ada waktu.

## Privasi dan keamanan

### Yang tidak pernah keluar perangkat

Gambar asli; nama pasien; NIK/ID; nomor rekam medis; tanggal lahir; alamat; telepon; nama dokter/fasilitas; teks mentah hasil OCR/ekstraksi di luar `results`.

### Yang dikirim ke cloud

Hanya array `results` (nama tes, nilai, satuan, rentang rujukan, flag) dan bahasa yang dipilih, melalui Firebase AI Logic dengan App Check.

### Threat model ringkas

| Ancaman | Mitigasi |
| --- | --- |
| Model on-device lupa menyamarkan PII dan PII masuk `results` | Guard anonimisasi deterministik (regex) sebelum kirim; pratinjau wajib ditinjau pengguna; tombol Explain memblokir jika guard mendeteksi pola |
| Fallback diam-diam ke cloud untuk gambar | Ekstraksi memakai `ONLY_ON_DEVICE`; `PREFER_ON_DEVICE` hanya di mode dev; `inferenceSource` dicatat dan dicek |
| Penyalahgunaan endpoint/biaya oleh pihak lain | App Check reCAPTCHA Enterprise + enforcement; kuota per project; budget alert |
| Kebocoran lewat log atau analytics | Tidak ada konten di log server; tidak ada analytics konten; log routing hanya di memori klien |
| Kunci API terekspos di klien | Kunci web Firebase bersifat publik; pembatasan lewat App Check dan restriksi domain |
| Prompt injection dari teks di foto | Output dibatasi skema; penjelasan di cloud tidak mengeksekusi tindakan; teks dari gambar diperlakukan sebagai data |
| Ekspektasi medis berlebihan | Disclaimer permanen; tidak ada diagnosis/obat; nilai `critical` mengarahkan ke tenaga medis |

Tanpa penyimpanan server secara default: tidak ada Firestore/Storage yang dipakai di MVP. Antrean offline hanya di IndexedDB lokal dan bisa dihapus pengguna.

## Permukaan UI dan pengalaman pengguna

1. **Home / Upload.** Dropzone, tombol "Try sample report", toggle EN/ID, status kesiapan on-device (browser, model, progress unduhan).
2. **Review.** Gambar dan tabel hasil ekstraksi berdampingan; PII ditampilkan sebagai chip tersamarkan; edit baris.
3. **Explanation.** Kartu per tes (nilai, rentang, flag berwarna + ikon), ringkasan, pertanyaan untuk dokter, disclaimer.
4. **Routing transparency (panel tetap).** Timeline langkah: ikon laptop (on-device) / awan (cloud), latensi, status; counter "0 byte PII sent"; tombol "Inspect cloud payload"; estimasi biaya hemat; indikator online/offline.
5. **Error/empty states.** Browser tak didukung, model belum terunduh, gambar bukan hasil lab, OCR buruk.

Desain: tenang dan klinis, tipografi mudah dibaca, warna flag tidak bergantung hanya pada warna (ikon + teks), mobile-aware tetapi hybrid penuh hanya di desktop.

## Fallback dan edge cases

| Kondisi | Perilaku |
| --- | --- |
| Model on-device belum terunduh | Tampilkan progress unduhan dan estimasi; tombol unggah ditahan; instruksi ke `chrome://on-device-internals` |
| Browser/OS tak didukung (bukan Chrome Desktop 139+) | Layar penjelasan dengan syarat; **tidak** ada fallback cloud untuk gambar; tawarkan "Sample report" (data sintetis) agar fitur cloud tetap bisa dicoba |
| OCR buruk / banyak nilai `unknown` | Peringatan kualitas, saran foto ulang (cahaya, tegak lurus), edit manual baris |
| Gambar bukan hasil lab | Hasil kosong → pesan "No lab results found"; tidak ada panggilan cloud |
| Format/ukuran file tak valid | Tolak sebelum inferensi (sudah ada di `extractOnDevice`); batasi ukuran (mis. ≤ 8 MB) dan skala ulang |
| Output JSON rusak | Satu kali retry dengan prompt lebih ketat; jika gagal, mode input manual |
| Offline saat Explain | Ringkasan on-device + antrean; sinkron saat online |
| Cloud gagal/kuota habis | Pesan jelas, tombol coba lagi, ringkasan on-device tetap tampil |
| App Check gagal | Pesan konfigurasi; di dev gunakan debug token |
| Guard anonimisasi mendeteksi PII | Blokir pengiriman, sorot baris, minta pengguna menyamarkan |
| Bahasa Indonesia kualitas rendah di Nano | Penjelasan selalu dari cloud; on-device hanya ekstraksi/ringkasan dasar; label kualitas pada ringkasan offline |

## Metrik keberhasilan

### Metrik produk

| Metrik | Target |
| --- | --- |
| PII lolos ke payload cloud (diuji pada 10 laporan sintetis) | 0 |
| Akurasi ekstraksi nilai (set uji sintetis) | ≥ 90% baris benar |
| Latensi ekstraksi on-device (p50) | ≤ 20 dtk |
| Latensi penjelasan cloud (p50) | ≤ 8 dtk |
| Pengguna uji memahami "apa yang lokal vs cloud" | ≥ 4 dari 5 |
| Gambar yang dikirim ke cloud | 0 |

### Pemetaan ke kriteria juri

Bobot kriteria belum diumumkan.

| Kriteria | Bukti di LabLens |
| --- | --- |
| **Technological Implementation** | Hybrid nyata: `ONLY_ON_DEVICE` untuk ekstraksi multimodal + structured output (`responseConstraint`), `ONLY_IN_CLOUD` untuk penjelasan; `inferenceSource` per langkah; App Check; guard anonimisasi; offline queue; skema ganda (JSON Schema dan `Schema`) |
| **Design** | Panel *Routing transparency*, alur 3 layar yang tenang, flag berikon, EN/ID, state error yang ramah, aksesibilitas |
| **Potential Impact** | Literasi kesehatan dan privasi data medis; relevan untuk pasien di banyak negara; pola "ekstrak lokal, jelaskan di cloud" dapat dipakai ulang di domain sensitif lain (keuangan, hukum) |
| **Quality of the Idea** | Hybrid dipakai karena alasan privasi, bukan gimmick; pembagian tugas eksplisit dan bisa diaudit pengguna |

## Cakupan rilis

**MVP (wajib submit):** FR-1–FR-5, FR-11, US-1–US-6, US-8, US-11; routing panel; deploy publik; video demo.
**Jika waktu cukup:** FR-6–FR-9 (rehydrate, offline queue, bilingual penuh, estimasi biaya).
**Setelah kompetisi:** PDF, Android on-device, multi-halaman, riwayat lokal terenkripsi.

### Demo data

Hanya hasil lab **sintetis** dengan identitas fiktif (dibuat sendiri, tidak memakai data pasien sungguhan), minimal 3 set: normal, beberapa abnormal, nilai kritis; satu dengan layout buruk untuk menguji OCR; satu bukan hasil lab.

## Ketergantungan teknologi dan pemetaan bonus

| Komponen | Versi/keterangan |
| --- | --- |
| Firebase JS SDK | `firebase 13.2.0`, `@firebase/ai 3.0.0` (`getAI`, `GoogleAIBackend`, `getGenerativeModel`, `InferenceMode`) |
| Framework | Next.js 16.4.5 (client-only untuk modul AI); baca `node_modules/next/dist/docs/` sebelum menulis kode karena API berbeda dari versi lama |
| On-device | Chrome Desktop 139+, Prompt API (Gemini Nano), single-turn, teks + gambar JPEG/PNG |
| Cloud | `gemini-3.5-flash-lite` via Firebase AI Logic (Gemini Developer API) |
| Keamanan | App Check dengan `ReCaptchaEnterpriseProvider`, enforcement AI Logic |

**Bonus challenges:** belum dirinci oleh penyelenggara. Pantau halaman Devpost; hipotesis: penggunaan fitur hybrid tertentu, App Check, atau multimodal. Jangan membuat keputusan arsitektur berdasarkan tebakan.

### Yang perlu diverifikasi di minggu pertama

- Spike `extractOnDevice` pada Chrome 139+ dengan gambar hasil lab nyata sintetis: akurasi, latensi, dan kepatuhan `responseConstraint`.
- Kualitas masking PII Gemini Nano pada bahasa Indonesia dan Inggris.
- Perilaku `inferenceSource` pada `ONLY_ON_DEVICE` vs `PREFER_ON_DEVICE`.
- Ukuran unduhan model dan spesifikasi hardware minimum; apakah mesin demo memenuhi syarat.
- Penegakan App Check pada domain deploy dan akses juri.

## Rencana video demo (≤ 3 menit; batas final menunggu Official Rules)

| Waktu | Adegan |
| --- | --- |
| 0:00–0:20 | Masalah: foto hasil lab penuh identitas → chatbot cloud. Janji LabLens |
| 0:20–0:50 | Unggah hasil lab sintetis; ekstraksi on-device; PII jadi chip tersamarkan |
| 0:50–1:30 | Klik Explain; penjelasan awam, flag, pertanyaan dokter; buka "Inspect cloud payload" membuktikan tak ada PII |
| 1:30–2:00 | Panel *Routing transparency*: lokasi, latensi, "0 byte PII sent", estimasi biaya hemat |
| 2:00–2:30 | **Wi-Fi dimatikan:** ringkasan dasar on-device tetap muncul, banner "queued"; Wi-Fi dinyalakan, analisis cloud selesai otomatis |
| 2:30–2:50 | Edge case: gambar bukan hasil lab / browser tak didukung; toggle Bahasa Indonesia |
| 2:50–3:00 | Penutup: arsitektur satu slide, tautan repo dan demo |

Rekam di Chrome Desktop yang sudah memuat model; siapkan Wi-Fi mati tanpa merusak sesi; takarir bahasa Inggris.

## Lini waktu (10–30 Nov 2026)

Deadline: **30 Nov 2026 14:00 PT** (1 Des 06:00 WITA). Target internal: submit 29 Nov malam WITA.

| Minggu | Fokus | Milestone |
| --- | --- | --- |
| 10–15 Nov | Spike dan fondasi | Firebase + App Check hidup; `extractOnDevice` jalan di Chrome 139+; skema tervalidasi; data sintetis; keputusan go/no-go kualitas Nano |
| 16–22 Nov | Fitur inti | Review UI, guard anonimisasi, `explainInCloud` dengan `ExplanationResult`, panel routing, deteksi kemampuan dan state error; deploy awal |
| 23–27 Nov | Kelengkapan | Offline queue, rehydrate, EN/ID, estimasi biaya, polesan desain dan aksesibilitas; uji privasi 10 laporan; **feature freeze 26 Nov** |
| 28–30 Nov | Submission | Rekam dan edit video, tulis deskripsi Devpost, cek repo/README/akses uji, submit paling lambat 29 Nov malam WITA; 30 Nov hanya cadangan |

Judging 9–16 Des, pengumuman 21 Des: aplikasi dan akses uji harus tetap hidup selama periode itu.

## Risiko, asumsi, dan pertanyaan terbuka

### Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Kualitas Gemini Nano untuk Bahasa Indonesia dan OCR foto rendah | Ekstraksi/masking salah | Guard regex deterministik; peninjauan pengguna; penjelasan selalu di cloud; set uji sintetis; fallback input manual |
| Juri tidak memiliki Chrome Desktop 139+/model Nano | Demo tak bisa dicoba | Video kuat; mode "Sample report" yang tetap menjalankan jalur cloud; petunjuk akses uji jelas; deploy publik |
| Official Rules berubah/terbit dengan syarat baru (video, repo publik, akses uji, bahasa) | Submission tak sesuai | Cek rules tiap minggu; siapkan repo, video EN, dan akses uji sejak awal |
| Fitur Prompt API/SDK berubah (masih eksperimental) | Kode rusak | Kunci versi dependensi; abstraksi di `models.ts`/`router.ts` |
| Klaim medis berlebihan | Reputasi dan risiko etika | Disclaimer, tanpa diagnosis, bahasa hati-hati, review prompt |
| Biaya/kuota cloud atau App Check bermasalah saat judging | Demo gagal | Budget alert, kuota, uji enforcement di domain produksi, debug token tidak dipakai di produksi |
| Waktu tersisa singkat (±20 hari, solo) | Fitur tak selesai | MVP jelas, feature freeze, P2 dibuang lebih dulu |
| Ukuran unduhan model dan hardware | Pengalaman awal buruk | Progress dan penjelasan; siapkan mesin demo di awal |

### Asumsi

- Pengembangan solo; modul AI sudah di-scaffold dan sesuai dengan dokumen ini.
- Data demo seluruhnya sintetis; tidak ada data pasien nyata.
- Gemini Developer API via Firebase AI Logic cukup untuk kuota demo.

### Pertanyaan terbuka

1. Official Rules belum terbit per 10 Nov 2026: format dan batas video, kewajiban repo publik, akses uji untuk juri, bahasa submission.
2. Bobot empat kriteria dan rincian "bonus challenges".
3. Apakah juri wajib dapat menjalankan on-device sendiri, atau video cukup?
4. Apakah `ONLY_ON_DEVICE` mengembalikan `inferenceSource` konsisten untuk panel transparansi?
5. Apakah guard regex cukup untuk format ID Indonesia (NIK, no. RM bervariasi per faskes)?
6. Nama dokter/faskes: cukup `kind: "other"` atau perlu `PiiKind` baru?

## Checklist submission

- [ ] Official Rules dibaca dan persyaratan dicatat
- [ ] Aplikasi ter-deploy publik; App Check dan enforcement aktif di domain produksi
- [ ] Akses uji untuk juri (URL, petunjuk Chrome 139+/flag, mode Sample report)
- [ ] Repo dengan README (setup, arsitektur, batasan), lisensi, tanpa rahasia
- [ ] Video demo (adegan Wi-Fi mati), takarir Inggris, diunggah sesuai ketentuan rules
- [ ] Deskripsi Devpost: masalah, solusi, arsitektur hybrid, pemetaan 4 kriteria, tech stack
- [ ] Diagram arsitektur dan screenshot panel *Routing transparency*
- [ ] Uji privasi 10 laporan sintetis: 0 PII di payload cloud (bukti terlampir)
- [ ] Disclaimer medis di UI dan README
- [ ] Bonus challenges dicek dan dibidik bila relevan
- [ ] Submit sebelum 30 Nov 2026 14:00 PT (target 29 Nov malam WITA); aplikasi tetap hidup hingga 21 Des
