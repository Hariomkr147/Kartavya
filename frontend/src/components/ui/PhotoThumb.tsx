import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders a photo, falling back to an ImageOff icon when there's no URL or
 * the URL fails to load (e.g. a mock-layer `blob:` URL that died with the
 * tab that created it). `className` should carry the sizing classes the
 * `<img>` would have used — the fallback box reuses them so layout doesn't
 * shift between the loaded and broken states.
 */
export function PhotoThumb({
  src,
  alt = "",
  className,
  iconClassName = "text-ink-faint size-5",
  fallbackClassName = "bg-surface-hover",
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  iconClassName?: string;
  /** Background for the fallback box — override on dark surfaces (e.g. the Lightbox). */
  fallbackClassName?: string;
}) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const broken = !src || erroredSrc === src;

  if (broken) {
    return (
      <div className={cn(fallbackClassName, "flex items-center justify-center", className)}>
        <ImageOff className={iconClassName} aria-hidden="true" />
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} onError={() => setErroredSrc(src)} />;
}
