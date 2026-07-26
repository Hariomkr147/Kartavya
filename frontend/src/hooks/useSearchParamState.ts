import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

function defaultSerialize<T>(v: T): string | undefined {
  return v == null ? undefined : String(v);
}
function defaultDeserialize<T>(raw: string): T {
  return raw as unknown as T;
}

/**
 * Mirrors one piece of UI state (a filter, a search term, a tab) to a single
 * URL query-string key — no server involved, purely `URLSearchParams` state
 * that `react-router` already owns. Makes a filtered view bookmarkable,
 * shareable, and survivable across refresh/back-button, which plain
 * `useState` filters elsewhere in the app don't get.
 *
 * `serialize`/`deserialize` default to identity for plain strings; pass them
 * to store arrays (e.g. comma-joined status filters) or other shapes.
 */
export function useSearchParamState<T = string>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string | undefined;
    deserialize?: (raw: string) => T;
  },
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const deserialize = options?.deserialize ?? defaultDeserialize<T>;

  const raw = searchParams.get(key);
  const value = useMemo(() => (raw == null ? defaultValue : deserialize(raw)), [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = useCallback(
    (next: T) => {
      const serialize = options?.serialize ?? defaultSerialize<T>;
      setSearchParams(
        (prev) => {
          const merged = new URLSearchParams(prev);
          const serialized = serialize(next);
          if (
            serialized === undefined ||
            serialized === "" ||
            serialized === String(defaultValue)
          ) {
            merged.delete(key);
          } else {
            merged.set(key, serialized);
          }
          return merged;
        },
        { replace: true },
      );
    },
    [key, setSearchParams, options, defaultValue],
  );

  return [value, setValue];
}

/** Comma-separated string[] codec for `useSearchParamState`. */
export const csvCodec = {
  serialize: (value: string[]) => (value.length ? value.join(",") : undefined),
  deserialize: (raw: string) => (raw ? raw.split(",").filter(Boolean) : []),
};
