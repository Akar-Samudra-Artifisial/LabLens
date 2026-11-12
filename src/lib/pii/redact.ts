import { LABEL_TOKENS, labelToken } from "./patterns";
import type { OcrPage, PiiDetection, PiiSpanKind } from "./types";

export const SPAN_PLACEHOLDERS: Readonly<Record<PiiSpanKind, string>> = {
  name: "[NAMA]",
  nik: "[NIK]",
  medical_record_number: "[NO_RM]",
  date_of_birth: "[TGL_LAHIR]",
  date: "[TANGGAL]",
  address: "[ALAMAT]",
  phone: "[TELEPON]",
  email: "[EMAIL]",
  doctor: "[DOKTER]",
  facility: "[FASKES]",
  header: "[DISENSOR]",
};

export const SPAN_KIND_LABEL: Readonly<Record<PiiSpanKind, string>> = {
  name: "Nama",
  nik: "NIK",
  medical_record_number: "No. RM / Lab",
  date_of_birth: "Tgl lahir",
  date: "Tanggal",
  address: "Alamat",
  phone: "Telepon",
  email: "Email",
  doctor: "Dokter",
  facility: "Faskes",
  header: "Zona kepala laporan",
};

const PUNCT_ONLY = /^[^\p{L}\p{N}]+$/u;

/**
 * Teks OCR tersensor: kata dalam span PII → placeholder jenisnya; kata lain di zona kepala laporan →
 * [DISENSOR] kecuali kata label ("Nama Pasien", "No. RM") dan tanda baca. Placeholder berurutan digabung.
 */
export function redactText(page: OcrPage, det: PiiDetection): string {
  const spanOf = new Map<number, number>();
  det.spans.forEach((s, si) => s.words.forEach((w) => spanOf.set(w, si)));
  const zone = new Set(det.zoneWords);
  return det.rows
    .map((row) => {
      const out: string[] = [];
      let last: string | null = null;
      for (const w of row) {
        const text = page.words[w].text;
        const si = spanOf.get(w);
        let token: string;
        let key: string | null = null;
        if (si !== undefined) {
          token = SPAN_PLACEHOLDERS[det.spans[si].kind];
          key = `s${si}`;
        } else if (zone.has(w) && !PUNCT_ONLY.test(text) && !LABEL_TOKENS.has(labelToken(text))) {
          token = SPAN_PLACEHOLDERS.header;
          key = "zone";
        } else token = text;
        if (key !== null && key === last) continue;
        // Placeholder pola berbeda tapi jenis sama yang berdempetan juga digabung.
        if (key !== null && out[out.length - 1] === token) {
          last = key;
          continue;
        }
        out.push(token);
        last = key;
      }
      return out.join(" ");
    })
    .join("\n");
}

/** Jumlah span per jenis (zona header dihitung 1 bila ada kata yang disensor di sana). */
export function countByKind(det: PiiDetection): Partial<Record<PiiSpanKind, number>> {
  const counts: Partial<Record<PiiSpanKind, number>> = {};
  for (const s of det.spans) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  if (det.zoneWords.length > 0) counts.header = 1;
  return counts;
}

/** Nilai PII dokumen ini yang diketahui (hanya di memori lokal) — dipakai guard sebelum kirim cloud. */
export interface KnownPii {
  /** Frasa utuh span (dicocokkan setelah normalisasi alfanumerik). */
  phrases: string[];
  /** Kata di zona header yang tidak di-whitelist (dicocokkan per token). */
  tokens: string[];
}

export function knownPiiFrom(page: OcrPage, det: PiiDetection): KnownPii {
  const spanWords = new Set(det.spans.flatMap((s) => s.words));
  return {
    phrases: det.spans.map((s) => s.text),
    tokens: det.zoneWords
      .filter((w) => !spanWords.has(w))
      .map((w) => page.words[w].text)
      .filter((t) => !LABEL_TOKENS.has(labelToken(t))),
  };
}
