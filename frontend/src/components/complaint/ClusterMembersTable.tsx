import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  SortableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { useSortableRows } from "@/hooks/useSortableRows";
import { pickComparators } from "@/lib/complaintSort";
import { relativeTime } from "@/lib/datetime";
import type { Complaint } from "@/types/api";

const MEMBER_COMPARATORS = pickComparators(
  "id",
  "status",
  "severity",
  "sla",
  "createdAt",
);

/**
 * A cluster's member complaints, for the admin and officer cluster pages.
 *
 * The two rendered the same six columns from the same anonymized `Complaint`
 * shape and differed only in where a row links to, so they share one table —
 * which is also what keeps their sorting identical. A cluster holds its whole
 * member list in the response, so this sorts client-side (`useSortableRows`),
 * the same as the officer queue and unlike the server-paginated admin
 * complaints table.
 */
export function ClusterMembersTable({
  complaints,
  hrefFor,
}: {
  complaints: Complaint[];
  hrefFor: (complaintId: string) => string;
}) {
  const { t } = useTranslation();
  const { sorted, sortableProps } = useSortableRows(complaints, MEMBER_COMPARATORS);

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-16">{t("columns.photo")}</TableHeaderCell>
          <SortableHeaderCell {...sortableProps("id")}>
            {t("columns.complaint")}
          </SortableHeaderCell>
          <SortableHeaderCell {...sortableProps("status")}>
            {t("filters.status")}
          </SortableHeaderCell>
          <SortableHeaderCell {...sortableProps("severity")}>
            {t("filters.severity")}
          </SortableHeaderCell>
          <SortableHeaderCell {...sortableProps("sla")}>
            {t("columns.sla")}
          </SortableHeaderCell>
          <SortableHeaderCell {...sortableProps("createdAt")}>
            {t("columns.filed")}
          </SortableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link
                to={hrefFor(c.id)}
                className="bg-surface-hover flex size-10 items-center justify-center overflow-hidden rounded-md"
              >
                <PhotoThumb
                  src={c.photoUrl}
                  className="size-full object-cover"
                  iconClassName="text-ink-faint size-4"
                />
              </Link>
            </TableCell>
            <TableCell>
              <Link
                to={hrefFor(c.id)}
                className="text-ink font-mono text-xs hover:underline"
              >
                {c.id}
              </Link>
            </TableCell>
            <TableCell>
              <StatusPill status={c.status} />
            </TableCell>
            <TableCell>
              {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
            </TableCell>
            <TableCell>{c.slaLabel && <SlaPill sla={c.slaLabel} />}</TableCell>
            <TableCell className="text-ink-muted text-sm">
              {relativeTime(c.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
