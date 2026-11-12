import { CloudIcon, DeviceIcon } from "./icons";

export type InferenceLocation = "device" | "cloud";

const STYLE: Readonly<Record<InferenceLocation, { cls: string; label: string }>> = {
  device: { cls: "border-device/40 bg-device-soft text-device-ink", label: "On this device" },
  cloud: { cls: "border-cloud/40 bg-cloud-soft text-cloud-ink", label: "Cloud" },
};

/** Penanda lokasi inferensi — warna + ikon + teks yang sama di seluruh app. */
export function LocationTag({ where, label, className = "" }: { where: InferenceLocation; label?: string; className?: string }) {
  const s = STYLE[where];
  const Icon = where === "device" ? DeviceIcon : CloudIcon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls} ${className}`}>
      <Icon size={14} />
      {label ?? s.label}
    </span>
  );
}

/** Ikon lokasi dalam lingkaran (timeline & stepper). */
export function LocationDot({ where, size = 32 }: { where: InferenceLocation; size?: 28 | 32 }) {
  const Icon = where === "device" ? DeviceIcon : CloudIcon;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border ${size === 32 ? "size-8" : "size-7"} ${
        where === "device" ? "border-device/50 bg-device-soft text-device-ink" : "border-cloud/50 bg-cloud-soft text-cloud-ink"
      }`}
    >
      <Icon size={16} />
    </span>
  );
}
