import type { SortableColumnProps } from "./useSortableRows";

/** Splits the contract's `field` / `-field` sort grammar into its two halves. */
function parse(sort: string): { field: string; descending: boolean } {
  return sort.startsWith("-")
    ? { field: sort.slice(1), descending: true }
    : { field: sort, descending: false };
}

/**
 * Column-header sorting for a table the *server* sorts and paginates.
 *
 * `useSortableRows` reorders rows already in memory, which is right for a
 * table that holds its whole list. It is wrong for the admin complaints
 * table: that one shows 15 rows of a set that can run to thousands, so
 * client-side sorting would silently reorder the current page and call it
 * "sorted by severity". This drives the `sort` query param instead, so the
 * whole filtered set is ordered by the database.
 *
 * The click cycle matches `useSortableRows.toggleSort` — asc, then desc, then
 * back to the table's default order — so the two behave identically to a user
 * even though only one of them touches the network. The one deliberate
 * difference: a column that *is* the default order has no distinct third
 * state, so it cycles asc ↔ desc rather than spending a click doing nothing.
 *
 * `fields` maps each column key to the server field name it sorts on; a
 * column absent from it is not server-sortable and keeps a plain header.
 */
export function useServerSortableColumns<K extends string>({
  sort,
  setSort,
  fields,
  defaultSort,
}: {
  sort: string;
  setSort: (next: string) => void;
  fields: Record<K, string>;
  defaultSort: string;
}) {
  const current = parse(sort);

  function sortableProps(key: K): SortableColumnProps {
    const field = fields[key];
    const active = current.field === field;
    return {
      active,
      direction: active && current.descending ? "desc" : "asc",
      onSort: () => {
        if (!active) return setSort(field);
        if (!current.descending) return setSort(`-${field}`);
        // Third click clears back to the default order — unless this column
        // already is that order, in which case asc is the only other state.
        setSort(parse(defaultSort).field === field ? field : defaultSort);
      },
    };
  }

  return { sortableProps };
}
