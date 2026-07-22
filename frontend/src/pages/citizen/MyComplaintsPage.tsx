import { useState } from "react";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { LinkButton } from "@/components/ui/LinkButton";
import { ComplaintListItem } from "@/components/complaint/ComplaintListItem";
import { useMyComplaints } from "@/hooks/useMyComplaints";
import { useCategories } from "@/hooks/useCategories";
import type { ComplaintStatus } from "@/types/api";

const STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
];

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  SUBMITTED: "Submitted",
  EVIDENCE_UNDER_REVIEW: "Evidence under review",
  NEEDS_MORE_EVIDENCE: "Needs more evidence",
  REJECTED: "Rejected",
  UNDER_REVIEW: "Under review",
  IN_PROGRESS: "In progress",
  UNDER_RESOLUTION: "Under resolution",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  UNRESOLVABLE: "Unresolvable",
};

const PAGE_SIZE = 10;

export function MyComplaintsPage() {
  const [status, setStatus] = useState<ComplaintStatus | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);

  const { data: categories } = useCategories();
  const { data, isLoading } = useMyComplaints({
    page,
    pageSize: PAGE_SIZE,
    sort: "-createdAt",
    status: status ? [status] : undefined,
    categoryId: categoryId || undefined,
  });

  const complaints = data?.data ?? [];
  const hasFilters = status !== "" || categoryId !== "";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-display-sm font-semibold text-ink">
          My Complaints
        </h1>
        <LinkButton to="/citizen/file">
          <FilePlus2 className="size-4" aria-hidden="true" />
          File a complaint
        </LinkButton>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="status-filter">Status</Label>
          <Select
            id="status-filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ComplaintStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="category-filter">Category</Label>
          <Select
            id="category-filter"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[4.5rem] w-full" />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <EmptyState
          icon={hasFilters ? ClipboardList : FilePlus2}
          title={hasFilters ? "No complaints match these filters" : "No complaints yet"}
          description={
            hasFilters
              ? "Try a different status or category."
              : "Report your first civic issue — a photo, a pin on the map, and a category is all it takes."
          }
          action={
            !hasFilters && <LinkButton to="/citizen/file">File a complaint</LinkButton>
          }
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <div className="space-y-2">
            {complaints.map((c) => (
              <ComplaintListItem
                key={c.id}
                complaint={c}
                to={`/citizen/complaints/${c.id}`}
              />
            ))}
          </div>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.pagination.totalItems}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
