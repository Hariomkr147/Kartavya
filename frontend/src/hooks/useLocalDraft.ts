import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "kartavya-draft:";

function readDraft<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Autosaves a piece of form state to localStorage under a namespaced key, so
 * a long form (filing a complaint, a dispute reason) survives an accidental
 * navigation or refresh — pure client persistence, no draft ever reaches the
 * server until the real submit. Writes are debounced by a animation-frame-ish
 * timeout so fast typing doesn't thrash `localStorage`.
 *
 * Returns `[value, setValue, { hasDraft, clearDraft }]`. `hasDraft` reflects
 * whether a saved draft existed at mount, so callers can show a "Restored
 * your draft" hint once.
 */
export function useLocalDraft<T>(key: string, initialValue: T) {
  // A plain (never-updated-back-to-true) piece of state, not a ref — reading
  // `.current` during render is off-limits under the strict hooks lint, and
  // this value only needs to be computed once at mount anyway.
  const [hadDraft, setHadDraft] = useState(() => readDraft<T>(key) !== undefined);
  const [value, setValue] = useState<T>(() => readDraft<T>(key) ?? initialValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        // Storage full/unavailable — drafts are a convenience, never required.
      }
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [key, value]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // Ignore — nothing to clean up if storage was never written.
    }
    setHadDraft(false);
  }, [key]);

  return [value, setValue, { hasDraft: hadDraft, clearDraft }] as const;
}
