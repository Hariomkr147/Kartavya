import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Breathing room between the panel and its trigger, and the viewport edge. */
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;
/** Below this, flipping buys nothing — scroll inside the panel instead. */
const MIN_PANEL_HEIGHT = 140;

export interface AnchoredPlacement {
  /** Document-space `top`, already accounting for a flip. */
  top: number;
  /** Document-space `left`, clamped to keep the panel inside the viewport. */
  left: number;
  /** Cap for the panel's height; pair with `overflow-y: auto`. */
  maxHeight: number;
  /** False for the one frame before measurement — keep the panel hidden. */
  measured: boolean;
  /** True when the panel was flipped above its trigger. */
  flipped: boolean;
}

/**
 * Keeps a portalled popup (menu, listbox, calendar) inside the viewport.
 *
 * Every floating panel in the app was positioned the same naive way: absolute,
 * `top: triggerRect.bottom + scrollY`, no height limit. That is correct right
 * up until the trigger sits low on the page — a row near the foot of a long
 * table, a filter at the bottom of a form — and then the panel renders past
 * the bottom of the window with no way to reach its lower half except zooming
 * out or scrolling the whole document.
 *
 * This measures the rendered panel against the space actually available and
 * either flips it above the trigger or caps its height so it scrolls
 * internally, preferring whichever leaves more of it visible.
 *
 * Returns `measured: false` on the first frame, before the panel has a height
 * to measure. Callers must keep the panel `visibility: hidden` until then,
 * otherwise it is briefly painted at the unflipped position.
 */
export function useAnchoredPlacement(
  open: boolean,
  triggerRect: DOMRect | null,
  panelRef: RefObject<HTMLElement | null>,
  fallbackTop: number,
  align: "start" | "end" = "start",
): AnchoredPlacement {
  // `forRect` is what makes `measured` self-invalidating: the trigger rect is
  // a fresh object on every open, so a placement computed for a previous open
  // no longer matches and reads as unmeasured without an effect to reset it.
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    maxHeight: number;
    flipped: boolean;
    forRect: DOMRect | null;
  }>({ top: fallbackTop, left: 0, maxHeight: 0, flipped: false, forRect: null });

  // Layout, not passive: this has to land before paint or the panel visibly
  // jumps from the unflipped position to the flipped one.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRect) return;

    const panelHeight = panelRef.current.scrollHeight;
    const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;

    // Only flip when it genuinely helps — the panel does not fit below, and
    // there is more room above than below.
    const flipped = panelHeight > spaceBelow && spaceAbove > spaceBelow;
    const available = Math.max(
      MIN_PANEL_HEIGHT,
      (flipped ? spaceAbove : spaceBelow) - PANEL_GAP,
    );
    const height = Math.min(panelHeight, available);

    // The same problem on the other axis, which only shows up on narrow
    // screens: an `end`-aligned panel hangs to the *left* of its trigger, so
    // a 224px panel under a trigger 150px from the left edge renders half
    // of itself off-screen with no way to scroll to it — the viewport does
    // not scroll left. Anchor by a clamped left instead of by `right`.
    const panelWidth = panelRef.current.getBoundingClientRect().width;
    const preferredLeft =
      align === "end" ? triggerRect.right - panelWidth : triggerRect.left;
    const left =
      Math.max(
        VIEWPORT_MARGIN,
        Math.min(preferredLeft, window.innerWidth - panelWidth - VIEWPORT_MARGIN),
      ) + window.scrollX;

    setPlacement({
      top: flipped
        ? triggerRect.top + window.scrollY - PANEL_GAP - height
        : triggerRect.bottom + window.scrollY + PANEL_GAP,
      left,
      maxHeight: available,
      flipped,
      forRect: triggerRect,
    });
  }, [open, triggerRect, panelRef, align]);

  return {
    top: placement.top,
    left: placement.left,
    maxHeight: placement.maxHeight,
    flipped: placement.flipped,
    measured: open && triggerRect !== null && placement.forRect === triggerRect,
  };
}

/**
 * Dismiss a panel on scroll or resize.
 *
 * A panel pinned to a rect captured at open time is wrong the moment anything
 * moves, and chasing it costs more than it is worth for a transient popup.
 * Scrolls originating *inside* the panel are ignored — panels cap their height
 * and scroll their own overflow, and that must not dismiss them.
 */
export function useDismissOnViewportChange(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function handleScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, panelRef, close]);
}
