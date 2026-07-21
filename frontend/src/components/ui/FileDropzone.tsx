import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  maxSizeBytes?: number;
  error?: string;
  className?: string;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png";
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;

/** Bespoke single-file dropzone for complaint evidence photos: drag-drop or click, client-side type/size validation, image preview. */
export function FileDropzone({
  file,
  onFileChange,
  accept = DEFAULT_ACCEPT,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  error,
  className,
}: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = accept.split(",");

  // Computed during render (memoized per `file`) rather than mirrored into
  // state via an effect — the effect below only handles the revoke cleanup.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function validateAndSet(candidate: File | null) {
    if (!candidate) {
      onFileChange(null);
      return;
    }
    if (!acceptedTypes.includes(candidate.type)) {
      setLocalError("Only JPEG or PNG photos are accepted.");
      return;
    }
    if (candidate.size > maxSizeBytes) {
      setLocalError(
        `Photo must be under ${Math.round(maxSizeBytes / (1024 * 1024))} MB.`,
      );
      return;
    }
    setLocalError(null);
    onFileChange(candidate);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    validateAndSet(e.dataTransfer.files?.[0] ?? null);
  }

  const displayError = error ?? localError ?? undefined;

  if (file && previewUrl) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-line",
          className,
        )}
      >
        <img
          src={previewUrl}
          alt="Selected evidence preview"
          className="max-h-64 w-full object-cover"
        />
        <button
          type="button"
          onClick={() => validateAndSet(null)}
          aria-label="Remove photo"
          className="bg-ink/60 hover:bg-ink/80 absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-full text-white transition-colors"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) =>
          (e.key === "Enter" || e.key === " ") && inputRef.current?.click()
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragActive
            ? "border-brand bg-teal-50"
            : "border-line-strong hover:border-brand",
          displayError && "border-status-rejected",
          className,
        )}
      >
        <ImagePlus className="text-ink-faint size-8" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">
          Drop a photo here, or click to browse
        </p>
        <p className="text-ink-faint text-xs">
          JPEG or PNG, up to {Math.round(maxSizeBytes / (1024 * 1024))} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => validateAndSet(e.target.files?.[0] ?? null)}
        />
      </div>
      {displayError && (
        <p className="text-status-rejected mt-1.5 text-xs">{displayError}</p>
      )}
    </div>
  );
}
