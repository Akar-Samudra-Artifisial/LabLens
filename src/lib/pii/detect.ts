import {
  digitize,
  editDistance,
  GENERIC_TITLE_WORDS,
  LABELS,
  labelToken,
  PATTERN_RULES,
  TABLE_HEADER_WORDS,
} from "./patterns";
import type { Bbox, FooterZone, HeaderZone, OcrPage, PiiDetection, PiiSpan, PiiSpanKind } from "./types";

interface Row {
  /** Indeks kata, urut x. */
  words: number[];
  /** Tepi atas/bawah setelah koreksi kemiringan (y - slope·x). */
  top: number;
  bottom: number;
  /** Median tinggi kata. */
  h: number;
}

interface RowText {
  s: string;
  /** s dengan huruf mirip-angka diganti (panjang sama). */
  sd: string;
  starts: number[];
  ends: number[];
}

interface LabelHit {
  /** Posisi kata dalam baris (bukan indeks global). */
  start: number;
  /** Eksklusif, termasuk token ":" sesudah label. */
  end: number;
  kind: PiiSpanKind | null;
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const PUNCT_ONLY = /^[^\p{L}\p{N}]+$/u;

/** Kemiringan halaman (dy/dx) = median kemiringan garis dasar baris OCR yang cukup panjang. */
export function pageSlope(page: OcrPage): number {
  const slopes = page.lines
    .filter((l) => l.baseline.x1 - l.baseline.x0 > 150)
    .map((l) => (l.baseline.y1 - l.baseline.y0) / (l.baseline.x1 - l.baseline.x0));
  const s = median(slopes);
  return Math.abs(s) < 0.25 ? s : 0;
}

/** Kelompokkan baris OCR menjadi baris visual: baris tesseract yang sejajar (kolom label | nilai) digabung. */
function buildRows(page: OcrPage, slope: number): Row[] {
  const byLine = new Map<number, number[]>();
  page.words.forEach((w, i) => byLine.set(w.line, [...(byLine.get(w.line) ?? []), i]));
  const segs = [...byLine.values()].map((ws) => {
    const tops = ws.map((i) => {
      const b = page.words[i].bbox;
      return b.y0 - slope * ((b.x0 + b.x1) / 2);
    });
    const bottoms = ws.map((i) => {
      const b = page.words[i].bbox;
      return b.y1 - slope * ((b.x0 + b.x1) / 2);
    });
    return {
      words: ws,
      top: median(tops),
      bottom: median(bottoms),
      x0: Math.min(...ws.map((i) => page.words[i].bbox.x0)),
      x1: Math.max(...ws.map((i) => page.words[i].bbox.x1)),
    };
  });
  segs.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  const groups: (typeof segs)[] = [];
  for (const seg of segs) {
    const c = (seg.top + seg.bottom) / 2;
    const h = seg.bottom - seg.top;
    const g = groups.find((grp) => {
      const gc = median(grp.map((s) => (s.top + s.bottom) / 2));
      const gh = median(grp.map((s) => s.bottom - s.top));
      return Math.abs(gc - c) < 0.5 * Math.max(h, gh) && grp.every((s) => s.x1 <= seg.x0 || seg.x1 <= s.x0);
    });
    if (g) g.push(seg);
    else groups.push([seg]);
  }
  return groups
    .map((grp) => {
      const words = grp.flatMap((s) => s.words).sort((a, b) => page.words[a].bbox.x0 - page.words[b].bbox.x0);
      return {
        words,
        top: Math.min(...grp.map((s) => s.top)),
        bottom: Math.max(...grp.map((s) => s.bottom)),
        h: median(words.map((i) => page.words[i].bbox.y1 - page.words[i].bbox.y0)),
      };
    })
    .sort((a, b) => a.top - b.top);
}

function rowText(page: OcrPage, row: Row): RowText {
  let s = "";
  let sd = "";
  const starts: number[] = [];
  const ends: number[] = [];
  row.words.forEach((i, k) => {
    if (k > 0) {
      s += " ";
      sd += " ";
    }
    const t = page.words[i].text;
    starts.push(s.length);
    s += t;
    sd += digitize(t);
    ends.push(s.length);
  });
  return { s, sd, starts, ends };
}

/** Posisi kata (dalam baris) yang beririsan dengan rentang karakter [a, b). */
function positionsIn(rt: RowText, a: number, b: number): number[] {
  const out: number[] = [];
  rt.starts.forEach((st, k) => {
    if (st < b && rt.ends[k] > a) out.push(k);
  });
  return out;
}

function findLabels(page: OcrPage, row: Row): LabelHit[] {
  const raw = row.words.map((i) => page.words[i].text);
  const toks = raw.map(labelToken);
  const hits: LabelHit[] = [];
  let k = 0;
  while (k < raw.length) {
    let hit: LabelHit | null = null;
    for (const def of LABELS) {
      const m = def.tokens.length;
      if (k + m > raw.length) continue;
      let fuzzy = 0;
      let ok = true;
      for (let j = 0; j < m && ok; j++) {
        const a = toks[k + j];
        const b = def.tokens[j];
        if (a === b) continue;
        // Toleransi salah baca OCR ("Tol. Lahir") hanya pada label multi-kata, 1 token, 1 huruf.
        if (m >= 2 && fuzzy === 0 && a.length >= 3 && b.length >= 3 && editDistance(a, b) <= 1) fuzzy++;
        else ok = false;
      }
      if (!ok) continue;
      const colon = raw[k + m - 1].includes(":") || (raw[k + m]?.startsWith(":") ?? false);
      if (def.needsColon && !colon) continue;
      // Kata label tanpa ":" tepat sesudah label lain adalah awal nilai ("Faskes: Puskesmas Coblong").
      const prev = hits[hits.length - 1];
      if (!colon && prev?.kind && prev.end === k) continue;
      hit = { start: k, end: k + m, kind: def.kind };
      break;
    }
    if (hit) {
      while (hit.end < raw.length && /^[:;|]+$/.test(raw[hit.end])) hit.end++;
      hits.push(hit);
      k = hit.end;
    } else k++;
  }
  return hits;
}

/** Potong deret posisi pada jarak horizontal besar (kolom berikutnya). */
function clipAtGap(page: OcrPage, row: Row, positions: number[]): number[] {
  const gap = 2.5 * row.h;
  const out: number[] = [];
  for (const p of positions) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const dx = page.words[row.words[p]].bbox.x0 - page.words[row.words[prev]].bbox.x1;
      if (p !== prev + 1 || dx > gap) break;
    }
    out.push(p);
  }
  return out;
}

const union = (bs: readonly Bbox[]): Bbox => ({
  x0: Math.min(...bs.map((b) => b.x0)),
  y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)),
  y1: Math.max(...bs.map((b) => b.y1)),
});

function makeSpan(page: OcrPage, kind: PiiSpanKind, words: number[], text?: string): PiiSpan {
  return {
    kind,
    words,
    bbox: union(words.map((i) => page.words[i].bbox)),
    text: text ?? words.map((i) => page.words[i].text).join(" ").replace(/^[:;\s]+/, ""),
  };
}

const RANGE = /(?<![\d/.,-])\d+(?:[.,]\d+)?\s?[-–]\s?\d+(?:[.,]\d+)?(?![\d/-])|[<>≤≥]\s?\d/;

/**
 * Deteksi PII deterministik dari hasil OCR (tanpa jaringan, tanpa model):
 * pola (NIK, telepon, email, tanggal, No. RM, nama bergelar dokter), nilai setelah label, dan zona kepala laporan.
 */
export function detectPii(page: OcrPage): PiiDetection {
  const slope = pageSlope(page);
  const rows = buildRows(page, slope);
  const spans: PiiSpan[] = [];
  const rowHits = rows.map((r) => findLabels(page, r));
  const rowSpanCount: number[] = rows.map(() => 0);

  rows.forEach((row, r) => {
    const rt = rowText(page, row);
    const hits = rowHits[r];
    const labelStarts = hits.map((h) => h.start);
    const labelSpans: PiiSpan[] = [];

    // 1) Nilai setelah label, sampai label berikutnya / jarak kolom.
    hits.forEach((hit, h) => {
      if (!hit.kind) return;
      const end = hits[h + 1]?.start ?? row.words.length;
      const pos = clipAtGap(
        page,
        row,
        Array.from({ length: end - hit.end }, (_, j) => hit.end + j),
      );
      const isPunct = (p: number) => PUNCT_ONLY.test(page.words[row.words[p]].text);
      while (pos.length > 0 && isPunct(pos[0])) pos.shift();
      while (pos.length > 0 && isPunct(pos[pos.length - 1])) pos.pop();
      if (pos.length === 0) return;
      const words = pos.map((p) => row.words[p]);
      labelSpans.push(makeSpan(page, hit.kind, words));

      // Alamat: baris lanjutan tepat di bawah nilai, sejajar kolom nilai, tanpa label.
      if (hit.kind === "address") {
        const x0 = page.words[words[0]].bbox.x0;
        let prev = row;
        for (let n = r + 1; n < rows.length && n <= r + 2; n++) {
          const next = rows[n];
          if (rowHits[n].length > 0 || next.top - prev.bottom > 1.2 * row.h) break;
          if (page.words[next.words[0]].bbox.x0 < x0 - 2 * row.h) break;
          labelSpans.push(makeSpan(page, "address", next.words));
          prev = next;
        }
      }
    });

    // 2) Pola tanpa label.
    const patternSpans: PiiSpan[] = [];
    for (const rule of PATTERN_RULES) {
      const text = rule.numeric ? rt.sd : rt.s;
      for (const m of text.matchAll(rule.re)) {
        const matched = rt.s.slice(m.index, m.index + m[0].length);
        if (rule.valid && !rule.valid(m[0])) continue;
        const all = positionsIn(rt, m.index, m.index + m[0].length);
        // Kata label ("MRN:") bukan PII; jangan menelan label berikutnya ("dr. Andi Wijaya, Sp.PD No. Lab …").
        let pos = all.filter((p) => !hits.some((h) => p >= h.start && p < h.end));
        const stop = labelStarts.find((ls) => ls > pos[0]);
        if (stop !== undefined) pos = pos.filter((p) => p < stop);
        pos = clipAtGap(page, row, pos);
        if (pos.length === 0) continue;
        patternSpans.push(makeSpan(page, rule.kind, pos.map((p) => row.words[p]), pos.length === all.length ? matched : undefined));
      }
    }
    // Span pola yang seluruhnya di dalam span label lebih spesifik → buang.
    const inLabel = new Set(labelSpans.flatMap((s) => s.words));
    const extra = patternSpans.filter((s) => !s.words.every((w) => inLabel.has(w)));
    // Span pola yang tumpang tindih sesamanya: simpan yang terpanjang.
    const kept: PiiSpan[] = [];
    for (const s of [...extra].sort((a, b) => b.words.length - a.words.length)) {
      if (!kept.some((k) => s.words.every((w) => k.words.includes(w)))) kept.push(s);
    }
    spans.push(...labelSpans, ...kept);
    rowSpanCount[r] = labelSpans.length + kept.length;
  });

  // 3) Zona kepala laporan: semua di atas baris header tabel (atau baris hasil lab pertama).
  const tokensOf = (row: Row) => row.words.map((i) => labelToken(page.words[i].text)).filter(Boolean);
  const boundary = rows.findIndex((row, r) => {
    const toks = new Set(tokensOf(row).filter((t) => TABLE_HEADER_WORDS.has(t)));
    if (toks.size >= 2) return true;
    const rt = rowText(page, row);
    return rowHits[r].length === 0 && rowSpanCount[r] === 0 && RANGE.test(rt.s) && /\p{L}{3,}/u.test(rt.s);
  });

  // Tepi bawah/atas kata dalam koordinat terkoreksi kemiringan, dihitung dari kedua sudut bbox (bukan median baris)
  // agar garis zona miring tidak memotong kata pada foto miring.
  const lowEdge = (i: number) => {
    const b = page.words[i].bbox;
    return Math.max(b.y1 - slope * b.x0, b.y1 - slope * b.x1);
  };
  const highEdge = (i: number) => {
    const b = page.words[i].bbox;
    return Math.min(b.y0 - slope * b.x0, b.y0 - slope * b.x1);
  };

  let zone: HeaderZone | null = null;
  const zoneWords: number[] = [];
  if (boundary > 0) {
    const b = rows[boundary];
    const above = rows.slice(0, boundary);
    const y0 = Math.max(b.top - 0.3 * b.h, ...above.flatMap((row) => row.words.map(lowEdge)).map((y) => y + 1));
    const generic = above.map((row) => {
      const toks = tokensOf(row).filter((t) => /\p{L}/u.test(t));
      return toks.length > 0 && toks.every((t) => GENERIC_TITLE_WORDS.has(t));
    });
    // Judul generik hanya dibiarkan bila tidak ada teks sensitif sejajar dengannya.
    const keep = above.map(
      (row, i) =>
        generic[i] && above.every((o, j) => j === i || generic[j] || o.bottom <= row.top || o.top >= row.bottom),
    );
    zone = {
      y0,
      slope,
      keepWords: above.flatMap((row, i) => (keep[i] ? row.words : [])),
      keepBands: above.flatMap((row, i) => (keep[i] ? [{ top: row.top - 2, bottom: row.bottom + 2 }] : [])),
    };
    above.forEach((row, i) => {
      if (!keep[i]) zoneWords.push(...row.words);
    });
  }

  // 4) Zona kaki laporan: semua di bawah baris tabel terakhir (baris berpola rentang rujukan).
  let footer: FooterZone | null = null;
  if (boundary >= 0) {
    let last = -1;
    rows.forEach((row, r) => {
      if (r < boundary) return;
      const s = rowText(page, row).s;
      if (rowHits[r].length === 0 && RANGE.test(s) && /\p{L}{2,}/u.test(s)) last = r;
    });
    if (last >= 0 && last < rows.length - 1) {
      const lr = rows[last];
      const below = rows.slice(last + 1);
      const y0 = Math.min(lr.bottom + 0.5 * (rows[last + 1].top - lr.bottom), ...below.flatMap((row) => row.words.map(highEdge)).map((y) => y - 1));
      footer = { y0, slope };
      below.forEach((row) => zoneWords.push(...row.words));
    }
  }

  return { spans, zone, footer, reviewRequired: zone === null, zoneWords, rows: rows.map((r) => r.words) };
}
