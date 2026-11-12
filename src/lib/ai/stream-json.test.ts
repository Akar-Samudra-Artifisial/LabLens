import { describe, expect, it } from "vitest";
import { createResultsStreamParser } from "./stream-json";

const FULL = JSON.stringify({
  results: [
    { testName: "Hemoglobin", value: "10.2", unit: "g/dL", referenceRange: "12.0 - 16.0" },
    { testName: 'Kurung {x} "kutip" \\ ]', value: "1", unit: "%", referenceRange: "<5" },
    { testName: "LED", value: "28", unit: "mm/jam", referenceRange: "0 - 20" },
  ],
  piiKinds: ["name"],
});

describe("createResultsStreamParser", () => {
  it("mengeluarkan tiap baris begitu objeknya lengkap, untuk potongan sekecil apa pun", () => {
    for (const size of [1, 3, 7, 50, FULL.length]) {
      const p = createResultsStreamParser<{ testName: string }>();
      const seen: { at: number; name: string }[] = [];
      for (let i = 0; i < FULL.length; i += size) {
        for (const r of p.push(FULL.slice(i, i + size))) seen.push({ at: i + size, name: r.testName });
      }
      expect(seen.map((s) => s.name)).toEqual(["Hemoglobin", 'Kurung {x} "kutip" \\ ]', "LED"]);
      if (size === 1) expect(seen[0].at).toBeLessThan(FULL.indexOf("Kurung"));
    }
  });

  it("'}' liar di level array tidak merusak parsing baris berikutnya", () => {
    const p = createResultsStreamParser<{ a: number }>();
    expect(p.push('{"results":[}},{"a":1},}')).toEqual([{ a: 1 }]);
    expect(p.push('{"a":2}]}')).toEqual([{ a: 2 }]);
  });

  it("escape dan kurung kurawal di dalam string (termasuk \\\\ di akhir string dan \\\" sebelum })", () => {
    const rows = [{ t: 'a\\' }, { t: '\\"}' }, { t: "{{]}}" }, { t: "\\\\\\\"{" }];
    const full = JSON.stringify({ results: rows });
    for (const size of [1, 2, 5]) {
      const p = createResultsStreamParser<{ t: string }>();
      const out: { t: string }[] = [];
      for (let i = 0; i < full.length; i += size) out.push(...p.push(full.slice(i, i + size)));
      expect(out).toEqual(rows);
    }
  });

  it("mengabaikan teks setelah array results dan sebelum key", () => {
    const p = createResultsStreamParser();
    expect(p.push('{"piiKinds":["nik"],"res')).toEqual([]);
    expect(p.push('ults":[{"a":1},')).toEqual([{ a: 1 }]);
    expect(p.push('{"a":2}],"x":{"a":3}}')).toEqual([{ a: 2 }]);
  });
});
