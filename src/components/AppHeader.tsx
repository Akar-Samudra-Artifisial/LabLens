import { type ReactNode, useSyncExternalStore } from "react";
import { CloudIcon, LensMark, SparkIcon } from "./icons";
import { useOnlineStatus } from "./useOnlineStatus";

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
/** Tab terlihat? Dekorasi bergerak dijeda saat tab tersembunyi. */
function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

const PILL = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur";

/** Titik status: menyala (breathe) saat siap; statis bila reduced-motion. */
function StatusDot({ tone }: { tone: "device" | "cloud" | "warn" | "muted" }) {
  const color = { device: "bg-device", cloud: "bg-cloud", warn: "bg-warn", muted: "bg-muted" }[tone];
  return (
    <span aria-hidden="true" className="relative flex size-2">
      {(tone === "device" || tone === "cloud") && <span className={`motion-decor absolute inset-0 rounded-full ${color} motion-safe:animate-ping opacity-60`} />}
      <span className={`relative size-2 rounded-full ${color}`} />
    </span>
  );
}

function OnlineIndicator() {
  const online = useOnlineStatus();
  return (
    <span
      className={`${PILL} ${online ? "border-cloud/40 bg-cloud-soft/80 text-cloud-ink shadow-glow-cloud" : "border-line-strong bg-surface-2/80 text-muted"}`}
      role="status"
      data-testid="online-status"
    >
      <StatusDot tone={online ? "cloud" : "muted"} />
      <CloudIcon size={14} />
      {online ? "Online — cloud available" : "Offline — cloud steps unavailable"}
    </span>
  );
}

interface AppHeaderProps {
  availability: string;
  warm: string | null;
  /** Visual alur (pipeline) yang ditampilkan di dalam hero. */
  children?: ReactNode;
}

/** Hero ringkas: aurora teal ↔ indigo + grid, wordmark, tagline privasi, status Gemini Nano + koneksi, lalu pipeline. */
export function AppHeader({ availability, warm, children }: AppHeaderProps) {
  const ready = availability === "available";
  const checking = availability === "checking…";
  const visible = useDocumentVisible();
  return (
    <header className="relative isolate overflow-hidden border-b border-line">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className={`hero-aurora motion-safe:animate-drift ${visible ? "" : "[animation-play-state:paused]"}`} />
        <div className="hero-grid" />
        <div className="hero-noise" />
      </div>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-5 pb-6 sm:px-6 lg:px-8 lg:pt-6 lg:pb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="surface-glass flex size-10 shrink-0 items-center justify-center rounded-xl text-device-ink shadow-glow-device">
              <LensMark size={22} />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">
              Lab<span className="text-gradient">Lens</span>
            </h1>
            <span className="hidden rounded-full border border-line-strong px-2 py-0.5 font-mono text-[11px] text-muted sm:inline">hybrid AI</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`${PILL} ${
                ready
                  ? "border-device/40 bg-device-soft/80 text-device-ink shadow-glow-device"
                  : checking
                    ? "border-line-strong bg-surface-2/80 text-muted"
                    : "border-warn/50 bg-warn-soft/80 text-warn-ink"
              }`}
              data-testid="nano-status"
            >
              <StatusDot tone={ready ? "device" : checking ? "muted" : "warn"} />
              <SparkIcon size={14} />
              <span>
                Gemini Nano: <code className="font-mono">{availability}</code>
                {warm && (
                  <>
                    {" "}
                    · model: <code className="font-mono">{warm}</code>
                  </>
                )}
              </span>
            </p>
            <OnlineIndicator />
          </div>
        </div>

        <div className="flex max-w-3xl flex-col gap-2">
          <p className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
            Your lab report, read <span className="text-device-ink">on this device</span>.
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            Private lab-report explainer. Names and ID numbers are masked before anything else happens; only anonymous test rows reach the{" "}
            <span className="text-cloud-ink">cloud</span> — and you can inspect every byte.
          </p>
        </div>

        {children}
      </div>
    </header>
  );
}
