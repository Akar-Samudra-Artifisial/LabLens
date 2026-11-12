import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LabTestResult } from "../lib/ai/schemas";
import { CriticalBanner } from "./CriticalBanner";

const row = (testName: string, flag: LabTestResult["flag"]): LabTestResult => ({ testName, value: "1", unit: "", referenceRange: "", flag });

describe("CriticalBanner (flag lokal, tanpa cloud)", () => {
  it("baris critical → banner role=alert berisi nama tes", () => {
    const html = renderToStaticMarkup(<CriticalBanner rows={[row("Hemoglobin", "normal"), row("Kalium", "critical")]} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="critical-banner"');
    expect(html).toContain("1 value is flagged critical: Kalium.");
  });

  it("tanpa baris critical → tidak dirender", () => {
    expect(renderToStaticMarkup(<CriticalBanner rows={[row("Hemoglobin", "low"), row("Leukosit", "high")]} />)).toBe("");
    expect(renderToStaticMarkup(<CriticalBanner rows={[]} />)).toBe("");
  });
});
