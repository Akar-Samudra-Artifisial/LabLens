import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, UploadIcon } from "../icons";
import { MUTED } from "../ui";

const ACCEPT = ["image/jpeg", "image/png"] as const;
const isAccepted = (f: File) => (ACCEPT as readonly string[]).includes(f.type);
const notAccepted = (f: File) => `“${f.name}” is not a JPEG or PNG image.`;

interface DropzoneProps {
  file: File | null;
  sample: string | null;
  /** Ganti key → input di-reset (mis. saat sampel dimuat). */
  inputKey: number;
  disabled: boolean;
  onFile: (file: File | null) => void;
}

/**
 * Pemilih laporan: klik/keyboard lewat <input type="file"> asli (sr-only, tetap fokus & dapat diakses)
 * + drag & drop. Label adalah area visual; cincin fokus mengikuti input lewat `peer`.
 */
export function Dropzone({ file, sample, inputKey, disabled, onFile }: DropzoneProps) {
  const id = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Drop yang meleset dari zona tidak boleh membuat browser membuka/menavigasi ke file (laporan privat
  // terbuka di tab). Handler zona (React, di root) jalan lebih dulu; sisanya ditolak di window.
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!isAccepted(f)) {
      setFileError(notAccepted(f));
      return;
    }
    setFileError(null);
    // Input asli dikosongkan agar memilih file yang sama lewat dialog tetap memicu onChange.
    if (inputRef.current) inputRef.current.value = "";
    onFile(f);
  }

  return (
    <div className="flex flex-col gap-2" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <input
        key={inputKey}
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPT.join(",")}
        disabled={disabled}
        aria-describedby={hintId}
        className="peer sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          // `accept` hanya saran dialog (bisa dilewati "All files") → tipe tetap divalidasi di sini.
          if (f && !isAccepted(f)) {
            e.target.value = "";
            setFileError(notAccepted(f));
            return;
          }
          setFileError(null);
          onFile(f);
        }}
      />
      <label
        htmlFor={id}
        className={`group relative flex cursor-pointer flex-col items-center gap-4 overflow-hidden rounded-card border-2 border-dashed px-5 py-6 text-center transition-[border-color,background-color,box-shadow] duration-200 sm:flex-row sm:text-left peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-60 ${
          dragging
            ? "border-device bg-device-soft shadow-glow-device"
            : "border-line-strong bg-surface-2/70 hover:border-device/60 hover:bg-device-soft/50 peer-focus-visible:border-device/60"
        }`}
      >
        <span
          aria-hidden="true"
          className={`btn-device grid size-12 shrink-0 place-items-center rounded-xl transition-transform duration-200 ${dragging ? "-translate-y-0.5 scale-105" : "motion-safe:group-hover:-translate-y-0.5"}`}
        >
          <UploadIcon size={22} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] font-semibold tracking-tight">
            <span className="sr-only">Lab report image (JPEG or PNG): </span>
            {dragging ? "Release to load the report" : file ? "Drop another report to replace it" : "Drop your lab report here"}
          </span>
          <span className={`text-sm ${MUTED}`}>
            or <span className="font-medium text-device-ink underline decoration-device/40 underline-offset-4 group-hover:decoration-device">browse files</span> · JPEG or PNG
          </span>
        </span>
      </label>
      <p id={hintId} className={`text-xs ${MUTED}`}>
        The image stays on this device — it is read and masked locally, never uploaded.
      </p>
      {/* Region live selalu dirender (isi berubah) agar pengumuman tidak hilang saat region baru dipasang. */}
      <div aria-live="polite" aria-atomic="true" className="empty:-mt-2">
        {file && (
          <p className="flex min-w-0 items-center gap-2 rounded-control border border-device/40 bg-device-soft px-3 py-2 text-xs text-ink" data-testid="selected-file">
            <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-full bg-ok text-surface">
              <CheckIcon size={10} strokeWidth={3} />
            </span>
            <span className="min-w-0 truncate">
              Selected: <span className="font-mono font-medium">{file.name}</span>
              {sample && <span className={MUTED}> (synthetic sample, fictitious data)</span>}
            </span>
          </p>
        )}
      </div>
      <div role="alert" className="empty:-mt-2">
        {fileError && <p className="text-sm text-danger-ink">{fileError}</p>}
      </div>
    </div>
  );
}
