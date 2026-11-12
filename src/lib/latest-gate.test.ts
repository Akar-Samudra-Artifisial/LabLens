import { describe, expect, it } from "vitest";
import { createLatestGate } from "./latest-gate";

/** Simulasi alur page.tsx: Explain mengambil token, Extract baru meng-invalidate sebelum respons tiba. */
async function explainFlow(gate: ReturnType<typeof createLatestGate>, response: Promise<string>, apply: (v: string) => void) {
  const token = gate.next();
  const v = await response;
  if (gate.isCurrent(token)) apply(v);
}

describe("createLatestGate", () => {
  it("token terbaru berlaku", () => {
    const g = createLatestGate();
    const t = g.next();
    expect(g.isCurrent(t)).toBe(true);
  });

  it("invalidate (dokumen baru) membuat respons lama diabaikan", async () => {
    const g = createLatestGate();
    const applied: string[] = [];
    let resolve!: (v: string) => void;
    const pending = explainFlow(g, new Promise<string>((r) => (resolve = r)), (v) => applied.push(v));
    g.invalidate(); // Extract dokumen baru saat Explain masih berjalan
    resolve("explanation-of-old-document");
    await pending;
    expect(applied).toEqual([]);
  });

  it("request lebih baru menang atas respons lambat request lama", async () => {
    const g = createLatestGate();
    const applied: string[] = [];
    let resolveOld!: (v: string) => void;
    const oldP = explainFlow(g, new Promise<string>((r) => (resolveOld = r)), (v) => applied.push(v));
    await explainFlow(g, Promise.resolve("new"), (v) => applied.push(v));
    resolveOld("old");
    await oldP;
    expect(applied).toEqual(["new"]);
  });
});
