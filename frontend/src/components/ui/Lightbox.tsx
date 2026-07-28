import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoThumb } from "@/components/ui/PhotoThumb";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
}

export interface LightboxProps {
  images: LightboxImage[];
  /** Index into `images` to open on, or null to keep the lightbox closed. */
  openIndex: number | null;
  onClose: () => void;
}

/** Full-screen image viewer — click-to-enlarge target for evidence photo thumbnails. Esc to close, arrow keys to step between images. */
export function Lightbox({ images, openIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(openIndex ?? 0);
  // Re-sync `index` to a fresh `openIndex` without an effect: comparing
  // against the previously-seen prop during render (React's documented
  // "adjusting state when a prop changes" pattern) rather than reacting to
  // it after the fact, which avoids an extra render + the set-state-in-
  // effect lint rule for what's really a derived value.
  const [lastOpenIndex, setLastOpenIndex] = useState(openIndex);
  if (openIndex !== lastOpenIndex) {
    setLastOpenIndex(openIndex);
    if (openIndex != null) setIndex(openIndex);
  }

  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (openIndex != null) triggerRef.current = document.activeElement;
  }, [openIndex]);

  useEffect(() => {
    if (openIndex == null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      else if (e.key === "ArrowLeft")
        setIndex((i) => (i - 1 + images.length) % images.length);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [openIndex, images.length, onClose]);

  if (openIndex == null) return null;
  const current = images[index];
  if (!current) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.caption ?? current.alt}
      className="animate-in fade-in fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/90 p-4 duration-150"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="size-5" aria-hidden="true" />
      </button>

      {images.length > 1 && (
        <button
          type="button"
          onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
          aria-label="Previous image"
          className="absolute left-2 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      )}

      <PhotoThumb
        src={current.src}
        alt={current.alt}
        className={cn("max-h-[80vh] max-w-full rounded-md object-contain shadow-lg")}
        iconClassName="size-12 text-white/60"
        fallbackClassName="bg-white/5"
      />

      {(current.caption || images.length > 1) && (
        <div className="mt-3 flex flex-col items-center gap-1 text-center text-sm text-white/80">
          {current.caption && <p>{current.caption}</p>}
          {images.length > 1 && (
            <p className="text-xs text-white/50">
              {index + 1} of {images.length}
            </p>
          )}
        </div>
      )}

      {images.length > 1 && (
        <button
          type="button"
          onClick={() => setIndex((i) => (i + 1) % images.length)}
          aria-label="Next image"
          className="absolute right-2 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>,
    document.body,
  );
}
