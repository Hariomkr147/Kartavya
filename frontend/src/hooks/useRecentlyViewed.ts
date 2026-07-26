import { useCallback, useState } from "react";

const PREFIX = "kartavya-recent:";
const MAX_ITEMS = 8;

export interface RecentItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  viewedAt: string;
}

function readAll(namespace: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(PREFIX + namespace);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Tracks "recently viewed" detail records (complaints, clusters, ...) purely
 * client-side — a localStorage ring buffer keyed by `namespace` (typically
 * `${role}:${userId}` so accounts never see each other's history on a
 * shared browser). Recording a view stores only the id/label/href already
 * known at render time; it does not itself fetch anything — clicking an
 * entry just navigates, which triggers the page's normal existing fetch.
 */
export function useRecentlyViewed(namespace: string) {
  const [items, setItems] = useState<RecentItem[]>(() => readAll(namespace));

  const persist = useCallback(
    (next: RecentItem[]) => {
      setItems(next);
      try {
        localStorage.setItem(PREFIX + namespace, JSON.stringify(next));
      } catch {
        // Best-effort — recently-viewed is a convenience, not required state.
      }
    },
    [namespace],
  );

  const record = useCallback(
    (item: Omit<RecentItem, "viewedAt">) => {
      const withoutExisting = readAll(namespace).filter((i) => i.id !== item.id);
      persist(
        [{ ...item, viewedAt: new Date().toISOString() }, ...withoutExisting].slice(
          0,
          MAX_ITEMS,
        ),
      );
    },
    [namespace, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { items, record, clear };
}
