import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoThumb } from "@/components/ui/PhotoThumb";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
  /**
   * Extra context rendered below the caption — e.g. the evidence gallery's
   * AI screening note. Caller-rendered rather than a data shape this
   * component understands, so `Lightbox` itself stays domain-agnostic.
   */
  description?: ReactNode;
}

export interface LightboxProps {
  images: LightboxImage[];
  /** Index into `images` to open on, or null to keep the lightbox closed. */
  openIndex: number | null;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex != null) triggerRef.current = document.activeElement;
  }, [openIndex]);

  useEffect(() => {
    if (openIndex == null) return;

    const node = dialogRef.current;
    const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusable?.[0] ?? node)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      else if (e.key === "ArrowLeft")
        setIndex((i) => (i - 1 + images.length) % images.length);

      // Same Tab-trap `Modal` uses — otherwise focus walks past the close/
      // prev/next buttons straight into the page hidden behind the overlay.
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={current.caption ?? current.alt}
      tabIndex={-1}
      className="animate-in fade-in fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/90 p-4 duration-150 focus:outline-none"
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

      {(current.caption || current.description || images.length > 1) && (
        <div className="mt-3 flex max-w-md flex-col items-center gap-1.5 text-center text-sm text-white/80">
          {current.caption && <p>{current.caption}</p>}
          {current.description}
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
