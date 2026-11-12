// Penilaian output Nano terhadap ground truth fixture.
// Per baris truth: 5 field (testName, value, unit, referenceRange, flag) → akurasi = benar / (baris × 5).
// PII: recall jenis (kind di maskedPii) + kebocoran (teks PII muncul di mana pun di output).

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/μ/g, "µ")
    .replace(/[^a-z0-9µ%<>]/g, "");

// "13.800" / "13,800" → 13800 ; "10.2" / "10,2" → 10.2
function num(s) {
  const t = String(s).trim().replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const nums = (s) => (String(s ?? "").match(/\d+(?:[.,]\d+)*/g) ?? []).map(num);

function sameValue(a, b) {
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 1e-9;
  return norm(a) === norm(b);
}

const UNIT_ALIASES = [
  ["/ul", "/µl", "x10^3/ul", "/mm3", "sel/ul", "/mcl"],
  ["juta/µl", "juta/ul", "10^6/µl", "x10^6/ul", "10^6/ul"],
  ["mm/jam", "mm/h", "mm/hr", "mm/1jam"],
];
function sameUnit(a, b) {
  const x = norm(a).replace(/u/g, "µ");
  const y = norm(b).replace(/u/g, "µ");
  if (x === y) return true;
  return UNIT_ALIASES.some((g) => {
    const gg = g.map((u) => norm(u).replace(/u/g, "µ"));
    return gg.includes(x) && gg.includes(y);
  });
}

function sameRange(a, b) {
  const na = nums(a);
  const nb = nums(b);
  if (na.length === 0 || na.length !== nb.length) return false;
  if (!na.every((v, i) => v === nb[i])) return false;
  const cmp = (s) => (String(s).match(/[<>≤≥]/) ?? [""])[0].replace("≤", "<").replace("≥", ">");
  return cmp(a) === cmp(b);
}

const tokens = (s) =>
  new Set(
    String(s ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t !== "calc"),
  );

// Prioritas: nama identik > himpunan kata sama ("Total Cholesterol" = "Cholesterol, Total") > substring.
function matchRow(truthRow, rows, used) {
  const t = norm(truthRow.testName);
  const tt = tokens(truthRow.testName);
  let best = -1;
  let bestScore = 0;
  rows.forEach((r, i) => {
    if (used.has(i)) return;
    const n = norm(r.testName);
    const nt = tokens(r.testName);
    const score =
      n === t ? 3 : tt.size === nt.size && [...tt].every((x) => nt.has(x)) ? 2 : n && (n.includes(t) || t.includes(n)) ? 1 : 0;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export function piiLeaks(truth, text) {
  const out = norm(text);
  const digits = String(text).replace(/\D/g, "");
  return truth.pii.filter(({ kind, text: v }) => {
    if (["nik", "medical_record_number", "phone", "date_of_birth"].includes(kind)) {
      const d = v.replace(/\D/g, "");
      return d.length >= 6 && digits.includes(d);
    }
    // nama/alamat/dokter: bocor bila ada token khas (≥4 huruf) yang muncul
    return v
      .split(/[\s,.]+/)
      .map(norm)
      .filter((tok) => tok.length >= 5 && !["bandung", "springfield", "cholesterol"].includes(tok))
      .some((tok) => out.includes(tok));
  });
}

export function scoreRun(truth, r) {
  if (!r.ok) return { summary: { jsonValid: false, error: r.error } };
  let parsed;
  try {
    parsed = JSON.parse(r.text);
  } catch (e) {
    return { summary: { jsonValid: false, error: `JSON.parse: ${e.message}` } };
  }
  const rows = Array.isArray(parsed.results) ? parsed.results : [];
  const used = new Set();
  const fields = { testName: 0, value: 0, unit: 0, referenceRange: 0, flag: 0 };
  const errors = [];
  for (const tr of truth.results) {
    const i = matchRow(tr, rows, used);
    if (i === -1) {
      errors.push({ test: tr.testName, missing: true });
      continue;
    }
    used.add(i);
    const o = rows[i];
    fields.testName++;
    const ok = {
      value: sameValue(o.value, tr.value),
      unit: sameUnit(o.unit, tr.unit),
      referenceRange: sameRange(o.referenceRange, tr.referenceRange),
      flag: o.flag === tr.flag,
    };
    for (const [k, v] of Object.entries(ok)) if (v) fields[k]++;
    const bad = Object.entries(ok).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) errors.push({ test: tr.testName, bad: Object.fromEntries(bad.map((k) => [k, { got: o[k], want: tr[k] }])) });
  }
  const total = truth.results.length;
  const correct = Object.values(fields).reduce((a, b) => a + b, 0);
  const kindsWanted = [...new Set(truth.pii.map((p) => p.kind).filter((k) => k !== "other"))];
  const kindsGot = new Set((parsed.maskedPii ?? []).map((p) => p.kind));
  const kindsFound = kindsWanted.filter((k) => kindsGot.has(k));
  const leaks = piiLeaks(truth, r.text);
  return {
    summary: {
      jsonValid: true,
      rowsOut: rows.length,
      rowsTruth: total,
      rowsMatched: fields.testName,
      extraRows: rows.length - used.size,
      fieldAcc: +(correct / (total * 5)).toFixed(3),
      perField: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, +(v / total).toFixed(3)])),
      piiKindRecall: +(kindsFound.length / kindsWanted.length).toFixed(3),
      piiKindsMissing: kindsWanted.filter((k) => !kindsGot.has(k)),
      piiLeaks: leaks.map((l) => l.kind),
    },
    errors,
  };
}
