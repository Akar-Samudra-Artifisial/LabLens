// Ringkas spike/results.json → tabel markdown (stdout). node spike/report.mjs
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("./results.json", import.meta.url), "utf8"));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–");

console.log(`Chrome: ${data.version} · availability: ${data.info.availability} · ${data.at}\n`);
console.log("| Fixture | Run | Prompt | JSON valid | Baris (out/truth/match) | Akurasi field | nama/nilai/unit/rentang/flag | PII kind recall | PII bocor | create ms | prompt ms | total ms |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of data.runs) {
  const s = r.score.summary;
  const pf = s.perField ? Object.values(s.perField).map(pct).join(" / ") : "–";
  console.log(
    `| ${r.fixture} | ${r.run} | ${r.promptLang} | ${s.jsonValid ? "ya" : `TIDAK (${s.error})`} | ${s.rowsOut ?? "–"}/${s.rowsTruth ?? "–"}/${s.rowsMatched ?? "–"} | ${pct(s.fieldAcc)} | ${pf} | ${pct(s.piiKindRecall)} | ${s.piiLeaks?.join(", ") || "–"} | ${r.createMs ?? "–"} | ${r.promptMs ?? "–"} | ${r.totalMs} |`,
  );
}

console.log("\n| Fixture | Prompt | n | JSON valid | Akurasi field rata² | PII kind recall rata² | Run dengan PII bocor | total ms rata² |");
console.log("|---|---|---|---|---|---|---|---|");
const groups = new Map();
for (const r of data.runs) {
  const k = `${r.fixture}|${r.promptLang}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
for (const [k, rs] of groups) {
  const [f, l] = k.split("|");
  const ok = rs.filter((r) => r.score.summary.jsonValid);
  console.log(
    `| ${f} | ${l} | ${rs.length} | ${ok.length}/${rs.length} | ${pct(avg(ok.map((r) => r.score.summary.fieldAcc)))} | ${pct(avg(ok.map((r) => r.score.summary.piiKindRecall)))} | ${ok.filter((r) => r.score.summary.piiLeaks.length).length}/${ok.length} | ${Math.round(avg(rs.map((r) => r.totalMs)))} |`,
  );
}
const idRuns = data.runs.filter((r) => r.promptLang === "id");
const okId = idRuns.filter((r) => r.score.summary.jsonValid);
console.log(
  `\nKeseluruhan (prompt id): JSON valid ${okId.length}/${idRuns.length}, akurasi field ${pct(avg(okId.map((r) => r.score.summary.fieldAcc)))}, PII kind recall ${pct(avg(okId.map((r) => r.score.summary.piiKindRecall)))}, cold total ${data.runs[0].totalMs} ms, warm rata² ${Math.round(avg(idRuns.slice(1).map((r) => r.totalMs)))} ms`,
);
