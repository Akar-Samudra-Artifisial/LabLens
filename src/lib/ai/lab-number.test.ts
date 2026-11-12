import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { labNumberCandidates, parseLabNumber, readLabRow } from "./lab-number";
import { flagFromRange } from "./schemas";

describe("labNumberCandidates / parseLabNumber", () => {
  it("berawalan 0 → selalu desimal", () => {
    expect(labNumberCandidates("0.350")).toEqual([0.35]);
    expect(labNumberCandidates("0,35")).toEqual([0.35]);
    expect(parseLabNumber("0.350")).toBe(0.35);
  });

  it("d.ddd ambigu → [ribuan, desimal]; ≥2 grup → ribuan; koma lain → desimal", () => {
    expect(labNumberCandidates("4.500")).toEqual([4500, 4.5]);
    expect(labNumberCandidates("13.800")).toEqual([13800, 13.8]);
    expect(labNumberCandidates("1.234.567")).toEqual([1234567]);
    expect(labNumberCandidates("1,5")).toEqual([1.5]);
    expect(labNumberCandidates("10.2")).toEqual([10.2]);
    expect(parseLabNumber("13.800")).toBe(13800); // tanpa konteks: konvensi Indonesia
  });

  it("'-', kosong, non-numerik → bukan angka", () => {
    for (const s of ["-", "", "  ", "positive", "negatif", "+", "1.234,5,6", "1,23.4"]) expect(parseLabNumber(s)).toBeNull();
  });

  it("kedua pemisah ada → yang terakhir desimal", () => {
    expect(labNumberCandidates("1.234,5")).toEqual([1234.5]);
    expect(labNumberCandidates("1,234.5")).toEqual([1234.5]);
    expect(labNumberCandidates("12.345.678,90")).toEqual([12345678.9]);
    expect(labNumberCandidates("1,234,567.25")).toEqual([1234567.25]);
  });

  it("minus di depan", () => {
    expect(labNumberCandidates("-5")).toEqual([-5]);
    expect(labNumberCandidates("−2.0")).toEqual([-2]);
    expect(labNumberCandidates("-0,5")).toEqual([-0.5]);
  });
});

describe("readLabRow + flagFromRange (konteks rentang baris yang sama)", () => {
  it.each([
    ["0.350", "0.2 - 0.6", 0.35, "normal"],
    ["0.350", "0.4 - 0.6", 0.35, "low"],
    ["4.500", "3.5 - 5.5", 4.5, "normal"],
    ["4.500", "5.0 - 6.0", 4.5, "low"],
    ["4.500", "1.0 - 3.0", 4.5, "high"],
    ["4.500", "4.000 - 10.000", 4500, "normal"],
    ["13.800", "4.000 - 10.000", 13800, "high"],
    ["13.800", "4.0 - 10.0", 13.8, "high"],
    ["13800", "4.000 - 10.000", 13800, "high"],
    ["452.000", "150.000 - 400.000", 452000, "high"],
    ["120.000", "150.000 - 400.000", 120000, "low"],
    ["250.000", "150.000-400.000", 250000, "normal"],
    ["1,5", "0,5 - 1,2", 1.5, "high"],
    ["1,5", "1 - 2", 1.5, "normal"],
    ["242", "<200", 242, "high"],
    ["150", "< 200", 150, "normal"],
    ["38", "> 40", 38, "low"],
    ["1.200", "< 5", 1.2, "normal"],
    ["<5", "0 - 10", 5, "normal"],
    // Lintas-konvensi: nilai & rentang sama-sama ambigu → satu konvensi untuk nilai DAN kedua batas.
    ["1.000", "150.000-400.000", 1000, "low"],
    ["1.000", "150.000 - 400.000", 1000, "low"],
    ["500.000", "150.000-400.000", 500000, "high"],
    ["4.500", "3.500-5.500", 4500, "normal"],
    ["2.500", "3.500 - 5.500", 2500, "low"],
    ["7.5", "4.000 - 10.000", 7.5, "normal"], // nilai tidak ambigu → rentang ikut skala nilai
    // Dua pemisah & minus.
    ["1.234,5", "1.000,0 - 2.000,0", 1234.5, "normal"],
    ["1,234.5", "1,500.0 - 2,000.0", 1234.5, "low"],
    ["-6", "-5 - 5", -6, "low"],
    ["0", "-5 - 5", 0, "normal"],
    ["2.5", "-2.0 – 2.0", 2.5, "high"],
    ["-1.5", "-2.0 – 2.0", -1.5, "normal"],
    ["-3", "> -2", -3, "low"],
  ] as const)("%s vs %s → %s (%s)", (value, range, n, flag) => {
    expect(readLabRow(value, range)?.value).toBe(n);
    expect(flagFromRange(value, range)).toBe(flag);
  });

  it("'-' / non-numerik / rentang tak terbaca → unknown", () => {
    expect(flagFromRange("-", "12 - 16")).toBe("unknown");
    expect(flagFromRange("positive", "negative")).toBe("unknown");
    expect(flagFromRange("5", "")).toBe("unknown");
    expect(flagFromRange("5", "-")).toBe("unknown");
    expect(readLabRow("-", "12 - 16")).toBeNull();
  });
});

describe("akurasi flag vs fixture *.truth.json", () => {
  const dir = join(__dirname, "../../../spike/fixtures");
  it.each(["a-id-hematologi", "b-us-lipid", "c-id-hematologi-foto"])("%s: semua flag benar", (name) => {
    const truth = JSON.parse(readFileSync(join(dir, `${name}.truth.json`), "utf8")) as {
      results: { testName: string; value: string; referenceRange: string; flag: string }[];
    };
    expect(truth.results.length).toBeGreaterThan(0);
    for (const r of truth.results) {
      expect({ test: r.testName, flag: flagFromRange(r.value, r.referenceRange) }).toEqual({ test: r.testName, flag: r.flag });
    }
  });
});
