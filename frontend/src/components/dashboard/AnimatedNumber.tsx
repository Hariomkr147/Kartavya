import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export interface AnimatedNumberProps {
  value: number;
  durationMs?: number;
  format?: (n: number) => string;
}

/** Counts up (or down) from whatever it last displayed to `value` — not just from zero, so a live refetch nudging 5→7 reads as a small bump, not a flash-reset. */
export function AnimatedNumber({
  value,
  durationMs = 800,
  format = (n) => n.toLocaleString(),
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    // Nothing to animate — the render below shows `value` directly for
    // reduced-motion users, so this effect has no state to synchronize.
    if (reducedMotion) return;

    const from = fromRef.current;
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplay(Math.round(from + (value - from) * easeOutExpo(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reducedMotion]);

  return <span className="tabular-nums">{format(reducedMotion ? value : display)}</span>;
}
