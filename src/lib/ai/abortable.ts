/**
 * SDK hybrid (@firebase/ai 3.0.0) tidak meneruskan AbortSignal ke inference on-device.
 * Wrapper ini membuat pemanggil berhenti menunggu begitu signal aborted; hasil lama diabaikan
 * (promise asli tetap jalan di latar, rejection-nya ditelan agar tidak jadi unhandled).
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Iterasi async yang berhenti (melempar signal.reason) begitu signal aborted, tanpa menunggu chunk berikutnya. */
export async function* iterateUntilAborted<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  for (;;) {
    const next = await raceAbort(it.next(), signal);
    if (next.done) return;
    yield next.value;
  }
}
