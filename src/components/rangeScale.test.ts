import { describe, expect, it } from "vitest";
import { flagFromRange } from "../lib/ai/schemas";
import { rangeGeometry, rangeSummary } from "./rangeScale";

describe("rangeGeometry (range bar, presentasi saja)", () => {
  it("nilai di bawah rentang → kiri zona normal", () => {
    const g = rangeGeometry("10.2", "12.0 - 16.0")!;
    expect(g.direction).toBe("below");
    expect(g.value).toBeLessThan(g.normal[0]);
    expect(g.deviation).toBeCloseTo(0.15, 2);
  });

  it("13.800 vs 4.000 - 10.000 (ribuan) → di atas rentang", () => {
    const g = rangeGeometry("13.800", "4.000 - 10.000")!;
    expect(g.direction).toBe("above");
    expect(g.value).toBeGreaterThan(g.normal[1]);
    expect(g.deviation).toBeCloseTo(0.38, 2);
  });

  it("0.350 dan 4.500 mengikuti flag lokal (interpretasi angka yang sama)", () => {
    expect(rangeGeometry("0.350", "0.200 - 0.500")!.direction).toBe("within");
    expect(rangeGeometry("0.350", "0.2 - 0.6")!.direction).toBe("within");
    expect(rangeGeometry("4.500", "3.5 - 5.5")!.direction).toBe("within");
    expect(rangeGeometry("4.500", "4.000 - 10.000")!.direction).toBe("within");
  });

  it("lintas-konvensi & rentang negatif", () => {
    expect(rangeGeometry("1.000", "150.000-400.000")!.direction).toBe("below");
    const g = rangeGeometry("-1.5", "-2.0 – 2.0")!;
    expect(g.direction).toBe("within");
    expect(g.normal).toEqual([25, 75]);
    expect(g.value).toBeCloseTo(31.25, 2);
  });

  it("nilai ekstrem dijepit ke tepi + ditandai clipped", () => {
    const g = rangeGeometry("400", "0 - 20")!;
    expect(g.clipped).toBe("high");
    expect(g.value).toBeLessThanOrEqual(98.5);
    expect(rangeGeometry("15", "16 - 18")!.clipped).toBeNull();
  });

  it("batas satu sisi, '-' dan non-numerik", () => {
    expect(rangeGeometry("150", "<200")!.direction).toBe("within");
    expect(rangeGeometry("250", "< 200")!.direction).toBe("above");
    expect(rangeGeometry("30", "> 40")!.direction).toBe("below");
    expect(rangeGeometry("40", "> 40")!.direction).toBe("below"); // flagFromRange: > 40 tidak terpenuhi → low
    expect(rangeGeometry("-", "12 - 16")).toBeNull();
    expect(rangeGeometry("positive", "negative")).toBeNull();
    expect(rangeGeometry("5", "")).toBeNull();
    expect(rangeGeometry("5", "-")).toBeNull();
  });

  it("penanda tidak pernah bertentangan dengan flag lokal", () => {
    const values = ["0", "0.35", "0.350", "2", "4.500", "10,2", "13.800", "28", "40", "150", "250", "452.000", "1,5", "1.000", "-1.5", "-6", "1.234,5"];
    const ranges = ["12.0 - 16.0", "4.000 - 10.000", "0.200 - 0.500", "0.2 - 0.6", "3.5 - 5.5", "3.500-5.500", "0 - 20", "1 - 3", "<200", "≤ 200", "> 40", "≥ 40", "150.000 - 400.000", "-5 - 5", "-2.0 – 2.0"];
    for (const v of values)
      for (const r of ranges) {
        const g = rangeGeometry(v, r);
        const flag = flagFromRange(v, r);
        if (!g) continue;
        expect({ v, r, d: g.direction }).toEqual({ v, r, d: { low: "below", high: "above", normal: "within" }[flag as "low"] });
        if (g.direction === "below") expect(g.value).toBeLessThanOrEqual(g.normal[0]);
        if (g.direction === "above") expect(g.value).toBeGreaterThanOrEqual(g.normal[1]);
        if (g.direction === "within") expect(g.value >= g.normal[0] - 1.5 && g.value <= g.normal[1] + 1.5).toBe(true);
      }
  });

  it("teks alternatif", () => {
    const g = rangeGeometry("13.800", "4.000 - 10.000")!;
    expect(rangeSummary("13.800", "/µL", "4.000 - 10.000", g)).toBe("13.800 /µL, above the reference range 4.000 - 10.000");
  });
});
