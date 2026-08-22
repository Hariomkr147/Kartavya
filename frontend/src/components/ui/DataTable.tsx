import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortableColumnProps } from "@/hooks/useSortableRows";
import { useDensity } from "@/contexts/DensityContext";
import { cn } from "@/lib/utils";

/**
 * `density` defaults to the app-wide `DensityProvider` preference (so most
 * tables need no extra prop) but can be overridden per-table if a page ever
 * needs to opt out. Compact mode tightens cell padding via `!` overrides —
 * `TableCell`/`TableHeaderCell` keep their own padding classes unchanged, so
 * this stays a one-line change at the `<Table>` call site.
 */
export function Table({
  className,
  density,
  ...props
}: HTMLAttributes<HTMLTableElement> & { density?: "comfortable" | "compact" }) {
  const { density: contextDensity } = useDensity();
  const effective = density ?? contextDensity;
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-line">
      <table
        className={cn(
          "w-full border-collapse text-sm",
          effective === "compact" &&
            "[&_td]:!py-1.5 [&_th>button]:!py-1.5 [&_th:not(:has(button))]:!py-1.5",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TableHead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-hover", className)} {...props} />;
}

export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("hover:bg-surface-hover transition-colors", className)}
      {...props}
    />
  );
}

export function TableHeaderCell({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "text-ink-muted px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 text-ink", className)} {...props} />;
}

export interface SortableHeaderCellProps
  extends ThHTMLAttributes<HTMLTableCellElement>, SortableColumnProps {}

/**
 * A `TableHeaderCell` that's also a sort control — click to cycle
 * asc → desc → unsorted (matches `useSortableRows`'s `toggleSort`). Pure
 * client-side re-ordering of rows already in memory, no server `sort` param.
 */
export function SortableHeaderCell({
  active,
  direction,
  onSort,
  className,
  children,
  ...props
}: SortableHeaderCellProps) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    // `aria-sort` belongs on the columnheader itself, not the button inside
    // it — on the button it is simply ignored, so a screen reader announced
    // no sort state at all.
    <TableHeaderCell
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("p-0", className)}
      {...props}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "flex w-full items-center gap-1.5 px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase transition-colors",
          active ? "text-ink" : "text-ink-muted hover:text-ink",
        )}
      >
        {children}
        <Icon
          className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-ink-faint")}
          aria-hidden="true"
        />
      </button>
    </TableHeaderCell>
  );
}

export function DataTableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        {children}
      </td>
    </tr>
  );
}
