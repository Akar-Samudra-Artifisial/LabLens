/** Kelas bersama (semua dari token di globals.css) agar tombol, kartu & teks konsisten di seluruh app. */

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const BTN_BASE = `inline-flex items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

/** Aksi yang berjalan di perangkat (teal). */
export const BTN_DEVICE = `${BTN_BASE} bg-device text-on-device hover:opacity-90`;
/** Aksi yang mengirim sesuatu ke cloud (indigo). */
export const BTN_CLOUD = `${BTN_BASE} bg-cloud text-on-cloud hover:opacity-90`;
export const BTN_SECONDARY = `${BTN_BASE} border border-line-strong bg-surface text-ink hover:bg-surface-2`;

export const CARD = "rounded-card border border-line bg-surface shadow-card";
export const CARD_BODY = "flex flex-col gap-4 p-4 sm:p-5";
export const MUTED = "text-muted";
export const H2 = "text-base font-semibold tracking-tight";

export const PRE = `overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink ${FOCUS}`;

/** Callout bertingkat — selalu disertai ikon/teks, bukan hanya warna. */
export const CALLOUT = {
  info: "rounded-control border border-line bg-surface-2 p-3 text-sm text-ink",
  device: "rounded-control border border-device/40 bg-device-soft p-3 text-sm text-ink",
  cloud: "rounded-control border border-cloud/40 bg-cloud-soft p-3 text-sm text-ink",
  warn: "rounded-control border border-warn/50 bg-warn-soft p-3 text-sm text-warn-ink",
  danger: "rounded-control border border-danger/50 bg-danger-soft p-3 text-sm text-danger-ink",
} as const;
