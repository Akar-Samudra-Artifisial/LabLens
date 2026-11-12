import { describe, expect, it } from "vitest";
import { iterateUntilAborted, raceAbort } from "./abortable";

const never = <T>() => new Promise<T>(() => {});

describe("raceAbort", () => {
  it("meneruskan hasil bila selesai sebelum abort", async () => {
    await expect(raceAbort(Promise.resolve(42), new AbortController().signal)).resolves.toBe(42);
  });

  it("meneruskan error asli", async () => {
    await expect(raceAbort(Promise.reject(new Error("boom")), new AbortController().signal)).rejects.toThrow("boom");
  });

  it("menolak dengan signal.reason saat abort, walau promise tak pernah selesai", async () => {
    const ctrl = new AbortController();
    const p = raceAbort(never<number>(), ctrl.signal);
    ctrl.abort(new DOMException("Ekstraksi melebihi 90 s", "TimeoutError"));
    await expect(p).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("sudah aborted sebelum mulai → langsung ditolak, rejection promise asli tidak bocor", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new DOMException("Dibatalkan pengguna", "AbortError"));
    await expect(raceAbort(Promise.reject(new Error("late")), ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("iterateUntilAborted", () => {
  it("menghasilkan semua chunk bila tidak di-abort", async () => {
    async function* src() {
      yield "a";
      yield "b";
    }
    const out: string[] = [];
    for await (const c of iterateUntilAborted(src(), new AbortController().signal)) out.push(c);
    expect(out).toEqual(["a", "b"]);
  });

  it("berhenti saat abort di tengah stream yang macet", async () => {
    const ctrl = new AbortController();
    async function* src() {
      yield "a";
      await never<void>();
      yield "b";
    }
    const out: string[] = [];
    const run = (async () => {
      for await (const c of iterateUntilAborted(src(), ctrl.signal)) {
        out.push(c);
        ctrl.abort(new DOMException("Dibatalkan pengguna", "AbortError"));
      }
    })();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(out).toEqual(["a"]);
  });
});
