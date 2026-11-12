/**
 * Pembacaan angka hasil lab + rentang rujukan — satu sumber untuk flag (flagFromRange) dan range bar (rangeGeometry).
 *
 * Aturan:
 * - "0.350" / "0,35" → selalu desimal (angka berawalan 0 tidak pernah ribuan).
 * - "1.234.567" (≥2 grup) → ribuan. Kedua pemisah ada ("1.234,5" / "1,234.5") → yang terakhir = desimal.
 * - "d.ddd" / "dd,ddd" (satu pemisah + tepat 3 digit) → AMBIGU: ribuan ala Indonesia ("13.800" /µL) atau desimal
 *   ("4.500" mmol/L). Semua token ambigu dalam satu baris (nilai + kedua batas) memakai konvensi yang SAMA; dipilih
 *   konvensi yang skalanya paling konsisten (jarak log10 nilai ke rentang terkecil). Seri → ribuan (konvensi Indonesia).
 * - Selain itu: koma = desimal ("1,5" → 1.5). Tanda minus di depan didukung ("-5", "−2.0").
 */

/** Kandidat nilai; untuk token ambigu urutannya [ribuan, desimal]. Kosong = bukan angka. */
export function labNumberCandidates(s: string): number[] {
  let t = s.trim().replace(/\s/g, "");
  let sign = 1;
  if (/^[-−]/.test(t)) {
    sign = -1;
    t = t.slice(1);
  }
  if (!/^\d/.test(t)) return [];
  const signed = (ns: number[]) => ns.map((n) => sign * n);
  if (t.includes(".") && t.includes(",")) {
    const dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const group = dec === "." ? "," : ".";
    const re = new RegExp(`^\\d{1,3}(\\${group}\\d{3})+\\${dec}\\d+$`);
    return re.test(t) ? signed([Number(t.split(group).join("").replace(dec, "."))]) : [];
  }
  if (/^0[.,]\d+$/.test(t)) return signed([Number(t.replace(",", "."))]);
  if (/^\d{1,3}([.,]\d{3}){2,}$/.test(t)) return signed([Number(t.replace(/[.,]/g, ""))]);
  if (/^\d{1,3}[.,]\d{3}$/.test(t)) return signed([Number(t.replace(/[.,]/g, "")), Number(t.replace(",", "."))]);
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? signed([n]) : [];
}

/** Tanpa konteks: token ambigu dibaca ribuan (konvensi Indonesia). Pakai readLabRow bila rentang tersedia. */
export function parseLabNumber(s: string): number | null {
  return labNumberCandidates(s)[0] ?? null;
}

type BoundOp = "<" | ">" | "≤" | "≥";
export type LabRange = { kind: "between"; lo: number; hi: number } | { kind: "bound"; op: BoundOp; lim: number };

export interface LabRow {
  value: number;
  range: LabRange;
}

const log = (n: number) => Math.log10(Math.max(Math.abs(n), 1e-9));

/** Jarak skala (log10) nilai ke rentang: 0 di dalam "a - b"; untuk batas tunggal, jarak ke batasnya. */
function scaleDistance(v: number, r: LabRange): number {
  if (r.kind === "bound") return Math.abs(log(v) - log(r.lim));
  if (v < r.lo) return Math.abs(log(r.lo) - log(v));
  if (v > r.hi) return Math.abs(log(v) - log(r.hi));
  return 0;
}

const NUM = String.raw`[-−]?\d[\d.,]*`;
const BETWEEN = new RegExp(`^(${NUM})\\s*[-–]\\s*(${NUM})$`);
const BOUND = new RegExp(`^([<>≤≥])\\s*=?\\s*(${NUM})$`);

/** 0 = ribuan, 1 = desimal; token tidak ambigu punya satu kandidat. */
const pick = (c: readonly number[], conv: 0 | 1) => (c.length === 2 ? c[conv] : c[0]);

/**
 * Nilai + rentang terbaca dengan konvensi angka yang konsisten. Null bila nilai bukan angka atau rentang bukan
 * "a - b" / "<x" / ">x" / "≤x" / "≥x". Komparator di nilai ("<5") diabaikan.
 */
export function readLabRow(value: string, range: string): LabRow | null {
  const vc = labNumberCandidates(value.replace(/[<>≤≥]/g, ""));
  if (!vc.length) return null;
  const r = range.trim();
  const between = r.match(BETWEEN);
  const bound = between ? null : r.match(BOUND);
  let build: (conv: 0 | 1) => LabRange | null;
  let tokens: number[][];
  if (between) {
    const a = labNumberCandidates(between[1]);
    const b = labNumberCandidates(between[2]);
    if (!a.length || !b.length) return null;
    tokens = [a, b];
    build = (conv) => {
      const lo = pick(a, conv);
      const hi = pick(b, conv);
      return lo <= hi ? { kind: "between", lo, hi } : null;
    };
  } else if (bound) {
    const l = labNumberCandidates(bound[2]);
    if (!l.length) return null;
    tokens = [l];
    build = (conv) => ({ kind: "bound", op: bound[1] as BoundOp, lim: pick(l, conv) });
  } else {
    return null;
  }
  const convs: (0 | 1)[] = [vc, ...tokens].some((c) => c.length === 2) ? [0, 1] : [0];
  let best: LabRow | null = null;
  let bestD = Infinity;
  for (const conv of convs) {
    const rr = build(conv);
    if (!rr) continue;
    const v = pick(vc, conv);
    const d = scaleDistance(v, rr);
    if (d < bestD - 1e-9) {
      best = { value: v, range: rr };
      bestD = d;
    }
  }
  if (best) return best;
  // Semua konvensi menghasilkan rentang terbalik: pakai konvensi default apa adanya (flag tetap deterministik).
  const lo = pick(tokens[0], 0);
  const hi = pick(tokens[tokens.length - 1], 0);
  return between ? { value: pick(vc, 0), range: { kind: "between", lo, hi } } : null;
}
