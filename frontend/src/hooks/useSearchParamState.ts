import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

function defaultSerialize<T>(v: T): string | undefined {
  return v == null ? undefined : String(v);
}
function defaultDeserialize<T>(raw: string): T {
  return raw as unknown as T;
}

/**
 * The params the current tick's writes have produced so far, tagged with the
 * query string they were built from. Module-level on purpose: separate
 * `useSearchParamState` calls are separate hook instances, so a per-instance
 * ref would not let `setZone` and `setPage` see each other. Cleared on the
 * microtask after the first write of a tick, so it can only ever compose
 * writes from one event handler — never survive a later render or a
 * back/forward navigation.
 */
let pendingWrite: { from: string; params: URLSearchParams } | null = null;

/**
 * One composing writer for the query string.
 *
 * react-router builds a functional `setSearchParams` update from the params of
 * the *last render* (`nextInit(new URLSearchParams(searchParams))`), so two
 * calls in one event handler both start from the same pre-navigation snapshot
 * and the second `navigate()` simply overwrites the first. Any page that keeps
 * more than one piece of state in the URL hits this the moment it changes two
 * of them together — `setZoneId(v); setPage(1)` navigated to "page reset, zone
 * unchanged", which read as "the filters do nothing".
 *
 * Composing through `pendingWrite` makes the second call build on what the
 * first produced. The `from` tag is what keeps it honest: once the navigation
 * commits, the next render's query string no longer matches and the base is
 * the real URL again.
 */
export function useSearchParamsWriter(): (
  mutate: (params: URLSearchParams) => void,
) => void {
  const [searchParams, setSearchParams] = useSearchParams();

  return useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const from = searchParams.toString();
      const base =
        pendingWrite?.from === from ? pendingWrite.params : new URLSearchParams(from);
      const next = new URLSearchParams(base);
      mutate(next);
      if (!pendingWrite) {
        queueMicrotask(() => {
          pendingWrite = null;
        });
      }
      pendingWrite = { from, params: next };
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );
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
 *
 * The setter also takes an updater function, `setValue(prev => next)`, for
 * state derived from what is already there (a toggle). Setters from several
 * `useSearchParamState` calls compose within one event handler — see
 * `useSearchParamsWriter`.
 */
export function useSearchParamState<T = string>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string | undefined;
    deserialize?: (raw: string) => T;
  },
): [T, (value: T | ((prev: T) => T)) => void] {
  const [searchParams] = useSearchParams();
  const write = useSearchParamsWriter();
  const deserialize = options?.deserialize ?? defaultDeserialize<T>;

  const raw = searchParams.get(key);
  const value = useMemo(() => (raw == null ? defaultValue : deserialize(raw)), [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const serialize = options?.serialize ?? defaultSerialize<T>;
      write((params) => {
        // An updater reads its `prev` back out of the params being composed,
        // not out of this render's closure, so two writes to the *same* key
        // in one handler build on each other the way two writes to different
        // keys already do. `toggle(a); toggle(b)` otherwise both started from
        // the last render's value and the second one won.
        const prevRaw = params.get(key);
        const value =
          typeof next === "function"
            ? (next as (prev: T) => T)(
                prevRaw == null ? defaultValue : deserialize(prevRaw),
              )
            : next;
        const serialized = serialize(value);
        // Only `undefined` and the serialized default drop the key, because
        // dropping it means "read back as the default". An empty string is a
        // value, not an absence: `?layers=` is how "every layer switched off"
        // is held for a param whose default is a non-empty list, and deleting
        // it there put every checkbox back on the moment the last one came
        // off. Comparing against `serialize(defaultValue)` rather than
        // `String(defaultValue)` is the same rule stated in the codec's own
        // terms, so array and date defaults are recognised too.
        if (serialized === undefined || serialized === serialize(defaultValue)) {
          params.delete(key);
        } else {
          params.set(key, serialized);
        }
      });
    },
    [key, write, options, defaultValue, deserialize],
  );

  return [value, setValue];
}

/**
 * Comma-separated string[] codec for `useSearchParamState`.
 *
 * The empty list serializes to "", not `undefined` — "none of them" is a
 * choice a user can make, and only the setter's default-comparison decides
 * whether it is worth a query param. For a filter defaulting to `[]` it still
 * drops the key; for the map's layers, whose default is a non-empty list, it
 * writes `?layers=` and the choice survives a reload.
 */
export const csvCodec = {
  serialize: (value: string[]) => value.join(","),
  deserialize: (raw: string) => (raw ? raw.split(",").filter(Boolean) : []),
};
