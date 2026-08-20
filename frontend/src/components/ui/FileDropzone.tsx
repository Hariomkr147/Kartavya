import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { compressPhoto } from "@/lib/imageCompression";
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
/** Mirrors the backend's MAX_UPLOAD_BYTES (2MB per photo, per openapi.yaml). */
const DEFAULT_MAX_SIZE = 2 * 1024 * 1024;

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
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasCamera = useHasCamera();
  const acceptedTypes = accept.split(",");
  const slotsLeft = maxFiles - files.length;

  async function addCandidates(candidates: FileList | File[] | null) {
    if (!candidates || slotsLeft <= 0) return;
    const list = Array.from(candidates).slice(0, slotsLeft);
    for (const candidate of list) {
      if (!acceptedTypes.includes(candidate.type)) {
        setLocalError(t("dropzone.wrongType"));
        return;
      }
    }
    setLocalError(null);

    // Compressed before the size check below runs, so a large-but-ordinary
    // phone photo (8-15MB is routine) gets shrunk instead of rejected
    // outright — the check becomes a backstop for the rare photo still too
    // big afterward, not the common case.
    //
    // `maxSizeBytes` is deliberately NOT passed as the compression target:
    // it's the backend's hard ceiling, and aiming at it told compressPhoto to
    // stop as soon as a photo squeaked under it. Its own default target sits
    // below that, leaving room for a best-effort result to overshoot and
    // still pass the check below.
    setCompressing(true);
    let processed: File[];
    try {
      processed = await Promise.all(list.map((candidate) => compressPhoto(candidate)));
    } finally {
      setCompressing(false);
    }

    const tooLarge = processed.some((file) => file.size > maxSizeBytes);
    if (tooLarge) {
      setLocalError(
        "That photo is still too large after compression. Try another one.",
      );
      return;
    }
    onFilesChange([...files, ...processed]);
  }

  function removeAt(index: number) {
    // A rejected add's error was about *that* attempt — removing any file,
    // including one unrelated to the rejection, is a different action and
    // shouldn't leave a stale "still too large" message sitting under
    // photos that satisfy it.
    setLocalError(null);
    onFilesChange(files.filter((_, i) => i !== index));
  }

  // Single-photo mode (maxFiles === 1, the default) hides the whole drop-
  // zone/browse prompt once the one slot is filled — `slotsLeft > 0` below
  // goes false — leaving nothing on screen that reads as "you can pick a
  // different one" besides the small, unlabeled ✕ on the thumbnail. This
  // clears the current file and reopens the picker in a single click so
  // there's an explicit, visible "Change photo" affordance instead. Safe to
  // call `inputRef.current?.click()` synchronously here even though
  // `onFilesChange([])` hasn't committed yet — the native file dialog takes
  // real user time to resolve, so by the time `onChange` actually fires,
  // React has already re-rendered with the freed-up slot.
  function replaceSinglePhoto() {
    onFilesChange([]);
    inputRef.current?.click();
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
            <FilePreview
              key={index}
              file={file}
              onRemove={() => removeAt(index)}
              onReplace={maxFiles === 1 ? replaceSinglePhoto : undefined}
            />
          ))}
        </div>
      )}

      {slotsLeft > 0 && (
        <div
          role="button"
          tabIndex={compressing ? -1 : 0}
          aria-busy={compressing}
          onClick={() => !compressing && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (!compressing && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!compressing) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={compressing ? (e) => e.preventDefault() : handleDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors",
            compressing ? "cursor-wait" : "cursor-pointer",
            dragActive
              ? "border-brand bg-teal-50"
              : "border-line-strong hover:border-brand",
            displayError && "border-status-rejected",
            className,
          )}
        >
          {compressing ? (
            <>
              <Loader2
                className="text-ink-faint size-8 animate-spin"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-ink">Compressing your photo…</p>
            </>
          ) : (
            <>
              <ImagePlus className="text-ink-faint size-8" aria-hidden="true" />
              <p className="text-sm font-medium text-ink">
                {files.length > 0
                  ? t("dropzone.addAnother", { current: files.length, max: maxFiles })
                  : hasCamera
                    ? t("dropzone.tapToChoose")
                    : t("dropzone.dropHere")}
              </p>
              {/*
                Deliberately no size limit in the copy. Compression runs
                before the check, so the 2MB ceiling is a backstop a citizen
                will essentially never hit — printing it only invited them to
                go resize a photo by hand for no reason.
              */}
              <p className="text-ink-faint text-xs">
                JPEG or PNG — large photos are shrunk automatically
                {maxFiles > 1 && ` · up to ${maxFiles} photos`}
              </p>
            </>
          )}
          {!compressing && hasCamera && (
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
              {t("dropzone.takePhoto")}
            </button>
          )}
        </div>
      )}
      {/*
        Outside the `slotsLeft > 0` block, and thus always mounted — even in
        single-photo mode once the one slot is filled and the drop-zone above
        stops rendering — so `replaceSinglePhoto`'s `inputRef.current?.click()`
        always has a real node to open.
      */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        className="sr-only"
        onChange={(e) => {
          addCandidates(e.target.files);
          // Without this, re-picking the exact same file after removing
          // it leaves the input's value unchanged, so the browser never
          // fires another `change` event and the photo silently fails to
          // re-add.
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        aria-label={t("dropzone.cameraInput")}
        className="sr-only"
        onChange={(e) => {
          addCandidates(e.target.files);
          // Without this, re-picking the exact same file after removing
          // it leaves the input's value unchanged, so the browser never
          // fires another `change` event and the photo silently fails to
          // re-add.
          e.target.value = "";
        }}
      />
      {displayError && (
        <p className="text-status-rejected mt-1.5 text-xs">{displayError}</p>
      )}
    </div>
  );
}

function FilePreview({
  file,
  onRemove,
  onReplace,
}: {
  file: File;
  onRemove: () => void;
  /** Single-photo mode only — the explicit, visible counterpart to the ✕ above, for when removing is the only way back to the picker (see `replaceSinglePhoto`). */
  onReplace?: () => void;
}) {
  const { t } = useTranslation();
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    // Deferred rather than immediate — revoking synchronously on unmount can
    // race an in-flight <img> decode of this same blob URL (e.g. a fast step
    // transition right after the file is picked), which logs a spurious
    // net::ERR_FILE_NOT_FOUND even though nothing is actually broken.
    return () => void setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
  }, [previewUrl]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-md border border-line">
        {previewUrl && (
          <img
            src={previewUrl}
            alt={t("dropzone.previewAlt")}
            className="h-32 w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("dropzone.removePhoto")}
          className="bg-ink/60 hover:bg-ink/80 absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full text-white transition-colors"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {onReplace && (
        <button
          type="button"
          onClick={onReplace}
          className="text-brand mt-1.5 text-xs font-medium hover:underline"
        >
          {t("dropzone.changePhoto")}
        </button>
      )}
    </div>
  );
}
