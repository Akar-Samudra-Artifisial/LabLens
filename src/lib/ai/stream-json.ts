/**
 * Parser inkremental untuk output streaming `{"results":[{…},{…}, …], …}`:
 * tiap kali satu objek di dalam array `results` lengkap, objek itu dikembalikan — tanpa menunggu JSON utuh.
 * Teks diterima sebagai potongan delta (Prompt API promptStreaming).
 */
export function createResultsStreamParser<T>(key = "results") {
  let buf = "";
  let pos = 0;
  let state: "seek" | "array" | "done" = "seek";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`, "g");

  return {
    /** Tambah potongan teks; kembalikan objek baris yang baru lengkap. */
    push(chunk: string): T[] {
      buf += chunk;
      const out: T[] = [];
      if (state === "seek") {
        keyRe.lastIndex = 0;
        const m = keyRe.exec(buf);
        if (!m) return out;
        state = "array";
        pos = m.index + m[0].length;
      }
      for (; state === "array" && pos < buf.length; pos++) {
        const c = buf[pos];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') inString = true;
        else if (c === "{") {
          if (depth === 0) objStart = pos;
          depth++;
        } else if (c === "}") {
          // "}" liar di level array (output degeneratif) diabaikan — depth tidak boleh negatif.
          if (depth === 0) continue;
          depth--;
          if (depth === 0 && objStart >= 0) {
            try {
              out.push(JSON.parse(buf.slice(objStart, pos + 1)) as T);
            } catch {
              // Objek rusak (output degeneratif) — dilewati; validasi akhir tetap memakai JSON.parse utuh.
            }
            objStart = -1;
          }
        } else if (c === "]" && depth === 0) state = "done";
      }
      return out;
    },
  };
}
