import { CloudIcon, DeviceIcon, LogoMark } from "./icons";
import { useOnlineStatus } from "./useOnlineStatus";

function OnlineIndicator() {
  const online = useOnlineStatus();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        online ? "border-cloud/40 bg-cloud-soft text-cloud-ink" : "border-line-strong bg-surface-2 text-muted"
      }`}
      role="status"
      data-testid="online-status"
    >
      <CloudIcon size={14} />
      {online ? "Online — cloud available" : "Offline — cloud steps unavailable"}
    </span>
  );
}

interface AppHeaderProps {
  availability: string;
  warm: string | null;
}

/** Header: identitas, tagline privasi, status Gemini Nano + koneksi. */
export function AppHeader({ availability, warm }: AppHeaderProps) {
  const ready = availability === "available";
  const checking = availability === "checking…";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-ink text-surface">
            <LogoMark size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">LabLens</h1>
            <p className="text-sm text-muted">Private lab-report explainer. Your report is read on this device; only anonymous test rows reach the cloud.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              ready ? "border-device/40 bg-device-soft text-device-ink" : checking ? "border-line-strong bg-surface-2 text-muted" : "border-warn/50 bg-warn-soft text-warn-ink"
            }`}
            data-testid="nano-status"
          >
            <DeviceIcon size={14} />
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
    </header>
  );
}
