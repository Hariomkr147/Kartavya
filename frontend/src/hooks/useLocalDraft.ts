import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "kartavya-draft:";
const DEFAULT_VERSION = 1;
// A month-old "in progress" complaint draft resurfacing is more confusing
// than helpful — restoring goes quiet (falls back to `initialValue`) past
// this age instead of silently reviving something the citizen has likely
// forgotten about.
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface DraftEnvelope<T> {
  v: number;
  savedAt: number;
  data: T;
}

export interface UseLocalDraftOptions<T> {
  /**
   * Bump when the persisted shape of `T` changes — a draft saved under a
   * different version is treated as absent rather than risk feeding a stale
   * shape back into the form.
   */
  version?: number;
  /** Drafts older than this are treated as absent. Defaults to 7 days. */
  maxAgeMs?: number;
  /**
   * Runs once on a draft actually recovered from storage, so a caller can
   * repair or clamp fields that depend on data this hook can't itself
   * persist (e.g. a wizard step number that implies photos/location the
   * draft never captured). Never run against `initialValue`.
   */
  sanitize?: (restored: T) => T;
}

function isEnvelope<T>(value: unknown): value is DraftEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "v" in value &&
    "savedAt" in value &&
    "data" in value
  );
}

function readDraft<T>(key: string, version: number, maxAgeMs: number): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    // Anything not shaped like an envelope — a foreign value, or the
    // pre-versioning format — is treated as no draft rather than guessed at.
    if (!isEnvelope<T>(parsed)) return undefined;
    if (parsed.v !== version) return undefined;
    if (Date.now() - parsed.savedAt > maxAgeMs) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

function writeDraft<T>(key: string, version: number, data: T) {
  try {
    const envelope: DraftEnvelope<T> = { v: version, savedAt: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch {
    // Storage full/unavailable — drafts are a convenience, never required.
  }
}

/**
 * Autosaves a piece of form state to localStorage under a namespaced key, so
 * a long form (filing a complaint, a dispute reason) survives an accidental
 * navigation or refresh — pure client persistence, no draft ever reaches the
 * server until the real submit. Writes are debounced at 300ms so fast typing
 * doesn't thrash `localStorage`, and are flushed synchronously on unmount and
 * on tab hide/close, so the last few keystrokes before a navigation are never
 * silently dropped by the debounce window.
 *
 * Returns `[value, setValue, { hasDraft, clearDraft }]`. `hasDraft` reflects
 * whether a saved draft existed at mount, so callers can show a "Restored
 * your draft" hint once.
 */
export function useLocalDraft<T>(
  key: string,
  initialValue: T,
  options?: UseLocalDraftOptions<T>,
) {
  const version = options?.version ?? DEFAULT_VERSION;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const sanitize = options?.sanitize;

  // A plain (never-updated-back-to-true) piece of state, not a ref — reading
  // `.current` during render is off-limits under the strict hooks lint, and
  // this value only needs to be computed once at mount anyway.
  const [hadDraft, setHadDraft] = useState(
    () => readDraft<T>(key, version, maxAgeMs) !== undefined,
  );
  const [value, setValue] = useState<T>(() => {
    const restored = readDraft<T>(key, version, maxAgeMs);
    if (restored === undefined) return initialValue;
    return sanitize ? sanitize(restored) : restored;
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by `clearDraft`, cleared by the next `setValue`. Removing the stored
  // draft is not enough on its own: the value still sits in React state, and
  // the unmount/pagehide `flush` below would write it straight back — which is
  // exactly how a submitted complaint's text reappeared in the form the next
  // time the citizen opened it. "Cleared" has to mean "and do not re-persist
  // what is currently held", right up until the value genuinely changes again.
  const clearedRef = useRef(false);
  // Always holds the latest `value` so `flush` (called from an event
  // listener or an unmount cleanup, never from a render) can write it
  // without depending on — and re-subscribing to — `value` itself. Synced in
  // an effect rather than assigned during render (mutating a ref outside an
  // effect is off-limits under the strict hooks lint); every commit is
  // already followed by this before any listener could fire, so it's never
  // stale when `flush` actually runs.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (clearedRef.current) return;
    writeDraft(key, version, valueRef.current);
  }, [key, version]);

  useEffect(() => {
    if (clearedRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      writeDraft(key, version, value);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [key, value, version]);

  // The effect above only *cancels* a pending write when it re-runs or on
  // unmount — it never sends the last few keystrokes typed inside the
  // debounce window. This flushes them synchronously instead: on an in-app
  // route change (this effect's own cleanup) and on a tab hide/close, where
  // a debounced timeout may never get the chance to fire at all.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const clearDraft = useCallback(() => {
    // Cancel any write still in flight — without this, a debounced write
    // scheduled just before `clearDraft` runs could land microseconds later
    // and silently resurrect the draft this call was meant to delete.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    clearedRef.current = true;
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // Ignore — nothing to clean up if storage was never written.
    }
    setHadDraft(false);
  }, [key]);

  // Any genuine edit after a clear starts a new draft — otherwise a citizen
  // who submits and then begins a second complaint would get no autosave at
  // all for the rest of the session.
  const setDraftValue = useCallback<typeof setValue>((next) => {
    clearedRef.current = false;
    setValue(next);
  }, []);

  return [value, setDraftValue, { hasDraft: hadDraft, clearDraft }] as const;
}
