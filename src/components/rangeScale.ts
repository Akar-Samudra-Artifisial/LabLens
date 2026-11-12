// Relatif (bukan "@/"): vitest proyek ini tidak memetakan alias.
import { readLabRow } from "../lib/ai/lab-number";
import { flagFromRange } from "../lib/ai/schemas";

/**
 * Geometri presentasi untuk range bar: posisi nilai terhadap rentang rujukan, dalam persen trek.
 * Murni UI. Arah (below/within/above) SELALU diambil dari flagFromRange (src/lib/ai/schemas.ts) — sumber
 * kebenaran flag — sehingga penanda tidak pernah bertentangan dengan badge flag.
 */

export type RangeDirection = "below" | "above" | "within";

export interface RangeGeometry {
  /** Posisi nilai (0–100), selalu di sisi zona normal yang sesuai flag. */
  value: number;
  /** Zona normal [mulai, selesai] (0–100). */
  normal: [number, number];
  /** Nilai jatuh di luar domain tampilan (dijepit ke tepi) → UI menampilkan panah tepi. */
  clipped: "low" | "high" | null;
  /** Deviasi relatif terhadap batas terdekat (0 = di dalam rentang), mis. 0.4 = 40% di atas batas atas. */
  deviation: number;
  direction: RangeDirection;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const EDGE = 1.5;

/** Null bila flag lokal "unknown" (nilai/rentang tak terbaca) — UI lalu tidak menggambar bar. */
export function rangeGeometry(valueRaw: string, rangeRaw: string): RangeGeometry | null {
  const flag = flagFromRange(valueRaw, rangeRaw);
  if (flag === "unknown") return null;
  // Interpretasi angka yang SAMA dengan flagFromRange (readLabRow) → posisi tidak pernah bertentangan dengan flag.
  const row = readLabRow(valueRaw, rangeRaw);
  if (!row) return null;
  const { value: v, range: r } = row;
  let lo: number;
  let hi: number;
  let dMin: number;
  let dMax: number;
  if (r.kind === "between") {
    if (r.hi <= r.lo) return null;
    lo = r.lo;
    hi = r.hi;
    const span = hi - lo;
    // Skala ilustratif: zona normal menempati 50% trek di tengah; tiap sisi = setengah lebar rentang.
    // Domain tidak turun di bawah 0 kecuali rentang/nilainya negatif (mis. base excess "-2.0 – 2.0").
    dMin = lo >= 0 && v >= 0 ? Math.max(0, lo - span * 0.5) : lo - span * 0.5;
    dMax = hi + span * 0.5;
  } else {
    const lim = r.lim;
    if (lim <= 0) return null;
    const upper = r.op === "<" || r.op === "≤";
    lo = upper ? 0 : lim;
    hi = upper ? lim : lim * 2;
    dMin = 0;
    dMax = upper ? lim * 1.6 : lim * 2;
  }
  const direction: RangeDirection = flag === "low" ? "below" : flag === "high" ? "above" : "within";
  const pct = (n: number) => ((n - dMin) / (dMax - dMin)) * 100;
  const normal: [number, number] = [clamp(pct(lo), 0, 100), clamp(pct(hi), 0, 100)];
  const raw = pct(v);
  // Penanda dijepit ke sisi yang sesuai flag (kasus tepi seperti v = batas pada "> x" tetap konsisten).
  const sided =
    direction === "below" ? Math.min(raw, normal[0]) : direction === "above" ? Math.max(raw, normal[1]) : clamp(raw, normal[0], normal[1]);
  const limit = direction === "below" ? lo : hi;
  return {
    value: clamp(sided, EDGE, 100 - EDGE),
    normal,
    clipped: raw < 0 ? "low" : raw > 100 ? "high" : null,
    deviation: direction === "within" || limit === 0 ? 0 : Math.abs(v - limit) / Math.abs(limit),
    direction,
  };
}

const DIRECTION_TEXT: Readonly<Record<RangeDirection, string>> = {
  below: "below the reference range",
  above: "above the reference range",
  within: "within the reference range",
};

/** Teks alternatif untuk pembaca layar, mis. "13.800 /µL, above the reference range 4.000 - 10.000". */
export function rangeSummary(value: string, unit: string, range: string, g: RangeGeometry): string {
  return `${[value, unit].filter(Boolean).join(" ")}, ${DIRECTION_TEXT[g.direction]} ${range}`.trim();
}

/** Keterangan skala (dipakai sekali per tabel/daftar + sebagai title bar). */
export const RANGE_SCALE_NOTE = "Illustrative scale — the normal band is centred, not drawn to exact proportion.";
