import { describe, expect, it } from "vitest";
import { flagFromRange } from "../lib/ai/schemas";
import { parseLabNumber, rangeGeometry, rangeSummary } from "./rangeScale";

describe("parseLabNumber (salinan aturan src/lib/ai/schemas.ts)", () => {
  it("pola ribuan Indonesia diikuti persis seperti flagFromRange", () => {
    expect(parseLabNumber("13.800")).toBe(13800);
    expect(parseLabNumber("4.500")).toBe(4500);
    // Aturan lib juga membaca ini sebagai ribuan; diikuti agar posisi tidak bertentangan dengan flag.
    expect(parseLabNumber("0.350")).toBe(350);
    expect(parseLabNumber("10,2")).toBe(10.2);
    expect(parseLabNumber("0.35")).toBe(0.35);
    expect(parseLabNumber("-")).toBeNull();
    expect(parseLabNumber("positive")).toBeNull();
    expect(parseLabNumber("")).toBeNull();
  });

  it("perilaku setara dengan parser lib (dibuktikan lewat flagFromRange di kedua sisi ambang)", () => {
    for (const s of ["13.800", "4.500", "0.350", "10,2", "0.35", "1.5", "200"]) {
      const n = parseLabNumber(s)!;
      expect(flagFromRange(s, `${n} - ${n * 2}`.replace(/\./g, ","))).not.toBe("unknown");
      // Nilai sama persis dengan batas bawah/atas → normal; jika parser berbeda, flag akan low/high.
      expect(flagFromRange(String(n), `0 - ${s}`)).toBe("normal");
      expect(flagFromRange(String(n + 1), `0 - ${s}`)).toBe("high");
    }
  });
});

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

  it("0.350 dan 4.500 mengikuti flag lokal", () => {
    expect(rangeGeometry("0.350", "0.200 - 0.500")!.direction).toBe("within");
    expect(rangeGeometry("4.500", "4.000 - 10.000")!.direction).toBe("within");
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
    const values = ["0", "0.35", "0.350", "2", "4.500", "10,2", "13.800", "28", "40", "150", "250", "452.000"];
    const ranges = ["12.0 - 16.0", "4.000 - 10.000", "0.200 - 0.500", "0 - 20", "1 - 3", "<200", "≤ 200", "> 40", "≥ 40", "150.000 - 400.000"];
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
