export interface LatestGate {
  /** Ambil token untuk request baru (membuat token sebelumnya usang). */
  next(): number;
  /** Buat semua token yang beredar usang (mis. dokumen baru dimuat). */
  invalidate(): void;
  isCurrent(token: number): boolean;
}

/** Gerbang "permintaan terbaru": respons dengan token usang diabaikan pemanggil. */
export function createLatestGate(): LatestGate {
  let current = 0;
  return {
    next: () => ++current,
    invalidate: () => {
      current++;
    },
    isCurrent: (token) => token === current,
  };
}
