import { useId } from "react";
import { CLOUD_EXTRACT_TIMEOUT_MS, EXTRACT_TIMEOUT_MS, type ExtractStage } from "@/lib/ai/router";
import { AlertIcon, CloudIcon, DeviceIcon, LockIcon, ScanIcon, SpinnerIcon } from "../icons";
import { LocationTag } from "../LocationTag";
import type { FallbackPreview } from "../PayloadInspector";
import { BTN_CLOUD, BTN_DEVICE, BTN_SECONDARY, CALLOUT, CARD, CARD_BODY, FOCUS, H2, MUTED, PRE } from "../ui";
import { Dropzone } from "./Dropzone";
import type { BusyMode } from "./types";

/** Laporan sintetis (data fiktif) di public/samples — sama dengan fixture spike. */
const SAMPLES = [
  { file: "a-id-hematologi.png", label: "Try sample (ID hematology)" },
  { file: "b-us-lipid.png", label: "Try sample (US lipid)" },
] as const;

const STAGE_LABEL: Record<ExtractStage, string> = {
  prep: "preparing image…",
  session: "preparing model…",
  prefill: "reading image…",
  generate: "writing results…",
};

interface UploadCardProps {
  file: File | null;
  sample: string | null;
  inputKey: number;
  sampleLoading: boolean;
  sampleError: string | null;
  availability: string;
  nanoReady: boolean;
  busy: boolean;
  busyMode: BusyMode;
  stage: ExtractStage | null;
  elapsedS: number;
  ocrDone: boolean;
  rowCount: number;
  explainRunning: boolean;
  ocrContext: boolean;
  error: string | null;
  ocrError: string | null;
  /** Fallback cloud privat (hanya ditampilkan selama belum ada hasil). */
  fallback: FallbackPreview | null;
  hasResult: boolean;
  showIntro: boolean;
  onFileChange: (file: File | null) => void;
  onSample: (name: string) => void;
  onExtract: (useNano: boolean) => void;
  onCancel: () => void;
  onOcrContextChange: (on: boolean) => void;
  onCloudExtract: () => void;
}

function ErrorLine({ children }: { children: string }) {
  return (
    <p className={`${CALLOUT.danger} flex items-start gap-2`} role="alert">
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}

/** Langkah 1–3: pilih laporan, baca & masking di perangkat, ekstraksi (Nano atau fallback cloud dengan persetujuan). */
export function UploadCard(p: UploadCardProps) {
  const nanoHintId = useId();
  const blocked = !p.file || p.busy || p.explainRunning;
  return (
    <section aria-labelledby="upload-heading" className={CARD}>
      <div className={CARD_BODY}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="upload-heading" className={H2}>
            Your lab report
          </h2>
          <LocationTag where="device" label="Processed on this device" />
        </div>

        <div className="flex flex-col gap-4">
          <Dropzone file={p.file} sample={p.sample} inputKey={p.inputKey} disabled={p.busy} onFile={p.onFileChange} />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sample reports">
              <span className={`text-xs font-medium ${MUTED}`}>No report at hand?</span>
              {SAMPLES.map((s) => (
                <button key={s.file} type="button" className={`${BTN_SECONDARY} px-3 py-1.5`} disabled={p.busy || p.sampleLoading} onClick={() => p.onSample(s.file)}>
                  {s.label}
                </button>
              ))}
            </div>
            <span className={`text-xs ${MUTED}`}>Synthetic reports with fictitious patients — no real data.</span>
          </div>
          {p.sampleError && (
            <p className="text-sm text-danger-ink" role="alert">
              {p.sampleError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {p.nanoReady ? (
              <button type="button" className={BTN_DEVICE} disabled={blocked} onClick={() => p.onExtract(true)}>
                {p.busy ? <SpinnerIcon size={16} /> : <DeviceIcon size={16} />}
                {p.busy ? "Reading…" : "Extract (on-device)"}
              </button>
            ) : (
              <>
                <button type="button" className={BTN_DEVICE} disabled={blocked} onClick={() => p.onExtract(false)}>
                  {p.busy && p.busyMode === "ocr" ? <SpinnerIcon size={16} /> : <ScanIcon size={16} />}
                  {p.busy && p.busyMode === "ocr" ? "Reading…" : "Read & mask on device"}
                </button>
                {p.availability === "downloadable" ? (
                  <button type="button" className={BTN_SECONDARY} disabled={blocked} onClick={() => p.onExtract(true)}>
                    Download Gemini Nano &amp; extract on-device
                  </button>
                ) : (
                  <button type="button" className={BTN_SECONDARY} disabled aria-describedby={nanoHintId}>
                    Extract (on-device) — needs Gemini Nano
                  </button>
                )}
              </>
            )}
            {p.busy && (
              <button type="button" className={BTN_SECONDARY} onClick={p.onCancel}>
                Cancel
              </button>
            )}
          </div>
          {!p.nanoReady && p.availability !== "downloadable" && (
            <p id={nanoHintId} className={`text-xs ${MUTED}`}>
              On-device extraction is unavailable because Gemini Nano is not available in this browser.
            </p>
          )}
        </div>

        {p.nanoReady && (
          <label className={`flex items-center gap-2 text-xs ${MUTED}`}>
            <input type="checkbox" className="size-4 accent-device" checked={p.ocrContext} disabled={p.busy} onChange={(e) => p.onOcrContextChange(e.target.checked)} />
            give redacted OCR text to Nano as context (experimental)
          </label>
        )}

        <p className="flex items-center gap-2 text-sm empty:hidden" aria-live="polite">
          {p.busy && <SpinnerIcon size={16} className={p.busyMode === "cloud" ? "text-cloud" : "text-device"} />}
          {p.busy &&
            (p.busyMode === "cloud" ? (
              <span>
                Private cloud extraction (masked text only)… {p.elapsedS} s / max {CLOUD_EXTRACT_TIMEOUT_MS / 1000} s
              </span>
            ) : p.busyMode === "ocr" ? (
              <span>Local OCR and identity masking… {p.elapsedS} s</span>
            ) : (
              <span>
                {p.ocrDone ? "OCR done · " : "Local OCR… · "}
                {p.stage ? STAGE_LABEL[p.stage] : "starting…"} {p.elapsedS} s / max {EXTRACT_TIMEOUT_MS / 1000} s
                {p.rowCount > 0 && ` · ${p.rowCount} rows so far`}
              </span>
            ))}
        </p>

        {p.error && <ErrorLine>{p.error}</ErrorLine>}
        {p.ocrError && <ErrorLine>{p.ocrError}</ErrorLine>}

        {p.fallback && !p.hasResult && (
          <div className={`${CALLOUT.cloud} flex flex-col gap-3`} data-testid="cloud-fallback">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Private cloud extraction (fallback)</p>
              <LocationTag where="cloud" label="Needs your consent" />
            </div>
            {p.fallback.state === "locked" ? (
              <p className="flex items-start gap-2 text-warn-ink" role="alert" data-testid="fallback-locked">
                <LockIcon size={16} className="mt-0.5 shrink-0" />
                <span>{p.fallback.reason} Nothing was sent.</span>
              </p>
            ) : (
              <>
                <p>
                  Sends only the masked OCR text of the results table ({p.fallback.payload.lines} lines, {p.fallback.payload.bytes.toLocaleString("en-US")} B) to
                  Gemini in the cloud through Firebase AI Logic. No image, no report header or footer; identity data is replaced by placeholders and the PII guard
                  re-checks the text before sending.
                </p>
                <details className="text-xs">
                  <summary className={`cursor-pointer font-medium ${FOCUS}`}>Show exactly what will be sent</summary>
                  <pre tabIndex={0} aria-label="Masked text for cloud extraction" className={`mt-2 max-h-64 ${PRE}`} data-testid="fallback-text">
                    {p.fallback.payload.text}
                  </pre>
                </details>
                <div>
                  <button type="button" className={BTN_CLOUD} disabled={p.busy || p.explainRunning} onClick={p.onCloudExtract}>
                    {p.busy && p.busyMode === "cloud" ? <SpinnerIcon size={16} /> : <CloudIcon size={16} />}
                    {p.busy && p.busyMode === "cloud" ? "Extracting…" : "Extract via private cloud (masked text)"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {p.showIntro && (
          <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2" data-testid="privacy-intro">
            <div className="flex flex-col gap-2">
              <LocationTag where="device" label="Stays on this device" />
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-device">
                <li>The report image, your name, ID numbers, dates of birth and addresses</li>
                <li>Text recognition (OCR) and identity masking</li>
                <li>Reading the results table with Gemini Nano</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <LocationTag where="cloud" label="Goes to the cloud — only when you click" />
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-cloud">
                <li>Anonymous test rows (name, value, unit, range) for a plain-language explanation</li>
                <li>If Nano is unavailable and you agree: the masked results-table text, never the image</li>
                <li>Every payload is re-checked by a PII guard and shown in the inspector</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
