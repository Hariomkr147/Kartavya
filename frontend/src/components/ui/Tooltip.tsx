import { useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom" | "right";
}

/** Bespoke tooltip: shows on hover/focus (keyboard-accessible), hides on blur/mouseleave/Escape. */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const id = useId();

  function show() {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (side === "right") {
      setPosition({
        top: rect.top + window.scrollY + rect.height / 2,
        left: rect.right + window.scrollX + 8,
      });
    } else {
      setPosition({
        top:
          side === "top" ? rect.top + window.scrollY - 8 : rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX + rect.width / 2,
      });
    }
    setOpen(true);
  }
  function hide() {
    setOpen(false);
  }

  return (
    <>
      {(() => {
        const child = children;
        return (
          <span
            ref={(node) => {
              anchorRef.current = node;
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            onKeyDown={(e) => e.key === "Escape" && hide()}
            aria-describedby={open ? id : undefined}
            className="inline-flex"
          >
            {child}
          </span>
        );
      })()}
      {open &&
        createPortal(
          <div
            role="tooltip"
            id={id}
            style={{
              position: "absolute",
              top: position.top,
              left: position.left,
              transform:
                side === "right"
                  ? "translateY(-50%)"
                  : `translate(-50%, ${side === "top" ? "-100%" : "0"})`,
            }}
            className={cn(
              "pointer-events-none z-50 rounded bg-ink px-2 py-1 text-xs whitespace-nowrap text-canvas shadow-md",
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
