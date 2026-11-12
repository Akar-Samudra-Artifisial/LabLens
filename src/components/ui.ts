/** Kelas bersama (semua dari token di globals.css) agar tombol, kartu & teks konsisten di seluruh app. */

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const BTN_BASE = `inline-flex items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-[transform,box-shadow,background-color,opacity] duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none ${FOCUS}`;

/** Aksi yang berjalan di perangkat (gradien teal → cyan + glow). */
export const BTN_DEVICE = `${BTN_BASE} btn-device font-semibold enabled:hover:-translate-y-px enabled:hover:shadow-glow-device`;
/** Aksi yang mengirim sesuatu ke cloud (gradien indigo → violet + glow). */
export const BTN_CLOUD = `${BTN_BASE} btn-cloud font-semibold enabled:hover:-translate-y-px enabled:hover:shadow-glow-cloud`;
export const BTN_SECONDARY = `${BTN_BASE} border border-line-strong bg-surface text-ink enabled:hover:-translate-y-px enabled:hover:bg-surface-2`;

export const CARD = "surface-card rounded-card";
export const CARD_BODY = "flex flex-col gap-4 p-4 sm:p-6";
export const MUTED = "text-muted";
export const H2 = "text-[15px] font-semibold tracking-tight";
/** Label kecil di atas angka/section (instrumen). */
export const EYEBROW = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted";
/** Angka tampilan (display weight). */
export const DISPLAY_NUM = "font-mono font-semibold tabular-nums tracking-tight";
/** Elemen kecil interaktif yang terangkat saat hover. */
export const LIFT = "transition-[transform,box-shadow] duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-lift";

export const PRE = `overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink ${FOCUS}`;

/** Blok payload bergaya konsol (selalu gelap). */
export const CONSOLE_PRE = `overflow-auto whitespace-pre-wrap break-words rounded-control border border-console-line bg-console p-3 font-mono text-xs leading-relaxed text-console-ink ${FOCUS}`;

/** Callout bertingkat — selalu disertai ikon/teks, bukan hanya warna. */
export const CALLOUT = {
  info: "rounded-control border border-line bg-surface-2 p-3 text-sm text-ink",
  device: "rounded-control border border-device/40 bg-device-soft p-3 text-sm text-ink",
  cloud: "rounded-control border border-cloud/40 bg-cloud-soft p-3 text-sm text-ink",
  warn: "rounded-control border border-warn/50 bg-warn-soft p-3 text-sm text-warn-ink",
  danger: "rounded-control border border-danger/50 bg-danger-soft p-3 text-sm text-danger-ink",
} as const;
