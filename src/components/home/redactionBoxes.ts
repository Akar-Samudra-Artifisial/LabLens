import type { OcrPage, PiiDetection } from "@/lib/pii";
import { redactionShapes } from "@/lib/pii/redact-image";
import type { RedactionBox } from "./types";

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Geometri redaksi yang SAMA dengan gambar tersensor (redactionShapes), dinormalisasi ke persen untuk overlay animasi.
 * Hanya presentasi: gambar sudah tersensor sebelum overlay ditampilkan.
 */
export function redactionBoxes(page: OcrPage, det: PiiDetection): RedactionBox[] {
  const { width: W, height: H } = page;
  if (!W || !H) return [];
  const { rects, polys } = redactionShapes(page, det);
  const box = (x0: number, y0: number, x1: number, y1: number, zone: boolean): RedactionBox | null => {
    const x = clamp((x0 / W) * 100);
    const y = clamp((y0 / H) * 100);
    const w = clamp((x1 / W) * 100) - x;
    const h = clamp((y1 / H) * 100) - y;
    return w > 0.2 && h > 0.2 ? { x, y, w, h, zone } : null;
  };
  const zones = polys.map((p) => box(Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])), true));
  const spans = rects.map(([x, y, w, h]) => box(x, y, x + w, y + h, false));
  return [...zones, ...spans].filter((b): b is RedactionBox => b !== null).sort((a, b) => a.y - b.y);
}
