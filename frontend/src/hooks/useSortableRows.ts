import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K | null;
  direction: SortDirection;
}

/** Maps each sortable column key to a value-extractor for that row (not a 2-arg comparator — `useSortableRows` handles the comparison itself, including direction and stability). */
export type ComparatorsByKey<T, K extends string> = Record<
  K,
  (row: T) => string | number | null | undefined
>;

/**
 * Client-side sort over rows already sitting in memory (a fetched page/list)
 * — no server `sort` param involved. `comparators` maps each sortable
 * column key to a value-extractor; direction and stability (equal values
 * keep their original relative order) are handled here.
 */
export function useSortableRows<T, K extends string>(
  rows: T[],
  comparators: ComparatorsByKey<T, K>,
  initial?: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(
    initial ?? { key: null, direction: "asc" },
  );

  function toggleSort(key: K) {
    setSort((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return { key: null, direction: "asc" };
    });
  }

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const accessor = comparators[sort.key];
    const withIndex = rows.map((row, index) => ({ row, index }));
    withIndex.sort((a, b) => {
      const av = accessor(a.row);
      const bv = accessor(b.row);
      if (av == null && bv == null) return a.index - b.index;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp === 0) return a.index - b.index;
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return withIndex.map((w) => w.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sorted, sort, toggleSort };
}
