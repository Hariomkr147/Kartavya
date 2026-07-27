import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const COARSE_POINTER = "(pointer: coarse)";

function matchMediaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeToPointer(onChange: () => void) {
  if (!matchMediaSupported()) return () => {};
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Touch devices get a second, camera-first input. A single input carrying
 * `capture` would force the camera and take the gallery away, so the two are
 * offered side by side — and the extra button never appears on a desktop,
 * where `capture` does nothing anyway. Subscribed rather than sampled once,
 * so plugging a mouse into a tablet is picked up.
 */
function useHasCamera(): boolean {
  return useSyncExternalStore(
    subscribeToPointer,
    () => (matchMediaSupported() ? window.matchMedia(COARSE_POINTER).matches : false),
    () => false,
  );
}

export interface FileDropzoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  /** Defaults to 1 (single-photo mode). */
  maxFiles?: number;
  accept?: string;
  maxSizeBytes?: number;
  error?: string;
  className?: string;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png";
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;

/** Bespoke dropzone for complaint evidence photos: drag-drop or click, client-side type/size validation, up to `maxFiles` image previews. */
export function FileDropzone({
  files,
  onFilesChange,
  maxFiles = 1,
  accept = DEFAULT_ACCEPT,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  error,
  className,
}: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasCamera = useHasCamera();
  const acceptedTypes = accept.split(",");
  const slotsLeft = maxFiles - files.length;

  function addCandidates(candidates: FileList | File[] | null) {
    if (!candidates || slotsLeft <= 0) return;
    const list = Array.from(candidates).slice(0, slotsLeft);
    for (const candidate of list) {
      if (!acceptedTypes.includes(candidate.type)) {
        setLocalError("Only JPEG or PNG photos are accepted.");
        return;
      }
      if (candidate.size > maxSizeBytes) {
        setLocalError(`Photo must be under ${Math.round(maxSizeBytes / (1024 * 1024))} MB.`);
        return;
      }
    }
    setLocalError(null);
    onFilesChange([...files, ...list]);
  }

  function removeAt(index: number) {
    // A rejected add's error was about *that* attempt — removing any file,
    // including one unrelated to the rejection, is a different action and
    // shouldn't leave a stale "must be under 5 MB" message sitting under
    // photos that satisfy it.
    setLocalError(null);
    onFilesChange(files.filter((_, i) => i !== index));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    addCandidates(e.dataTransfer.files);
  }

  const displayError = error ?? localError ?? undefined;

  return (
    <div>
      {files.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((file, index) => (
            <FilePreview key={index} file={file} onRemove={() => removeAt(index)} />
          ))}
        </div>
      )}

      {slotsLeft > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragActive ? "border-brand bg-teal-50" : "border-line-strong hover:border-brand",
            displayError && "border-status-rejected",
            className,
          )}
        >
          <ImagePlus className="text-ink-faint size-8" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">
            {files.length > 0
              ? `Add another photo (${files.length}/${maxFiles})`
              : hasCamera
                ? "Tap to choose a photo"
                : "Drop a photo here, or click to browse"}
          </p>
          <p className="text-ink-faint text-xs">
            JPEG or PNG, up to {Math.round(maxSizeBytes / (1024 * 1024))} MB
            {maxFiles > 1 && ` · up to ${maxFiles} photos`}
          </p>
          {hasCamera && (
            <button
              type="button"
              onClick={(e) => {
                // The dropzone itself opens the file browser; stop the click
                // reaching it so the camera button doesn't open both.
                e.stopPropagation();
                cameraInputRef.current?.click();
              }}
              className="border-brand/40 text-brand hover:bg-brand/10 mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              <Camera className="size-3.5" aria-hidden="true" />
              Take a photo
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={maxFiles > 1}
            className="sr-only"
            onChange={(e) => addCandidates(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={accept}
            capture="environment"
            aria-label="Take a photo with the camera"
            className="sr-only"
            onChange={(e) => addCandidates(e.target.files)}
          />
        </div>
      )}
      {displayError && <p className="text-status-rejected mt-1.5 text-xs">{displayError}</p>}
    </div>
  );
}

function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    // Deferred rather than immediate — revoking synchronously on unmount can
    // race an in-flight <img> decode of this same blob URL (e.g. a fast step
    // transition right after the file is picked), which logs a spurious
    // net::ERR_FILE_NOT_FOUND even though nothing is actually broken.
    return () => void setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
  }, [previewUrl]);

  return (
    <div className="relative overflow-hidden rounded-md border border-line">
      {previewUrl && (
        <img src={previewUrl} alt="Selected evidence preview" className="h-32 w-full object-cover" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="bg-ink/60 hover:bg-ink/80 absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full text-white transition-colors"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
