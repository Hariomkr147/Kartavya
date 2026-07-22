import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  DataTableEmpty,
} from "@/components/ui/DataTable";
import { DynamicIcon } from "@/components/DynamicIcon";
import { BatchStatusModal } from "@/components/complaint/BatchStatusModal";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOfficerQueue } from "@/hooks/useOfficerQueue";
import { useClaimComplaint } from "@/hooks/useClaimComplaint";
import { useCategories } from "@/hooks/useCategories";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";
import type { GetOfficerQueueParams } from "@/services/officer";
import type { ComplaintStatus, SeverityLabel } from "@/types/api";

const ACTIVE_STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "REOPENED",
];

type QueueTab = "active" | "overdue" | "unassigned" | "mine";

const TAB_LABELS: Record<QueueTab, string> = {
  active: "All Active",
  overdue: "Overdue",
  unassigned: "Unassigned",
  mine: "My Queue",
};

const PAGE_SIZE = 10;
// The API has no free-text search or "assigned to me" filter, so those two
// narrowings happen client-side over a generously-sized fetch, then get
// paginated locally — see the `rows`/`paged` derivation below.
const FETCH_SIZE = 100;

export function OfficerQueuePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<QueueTab>("active");
  const [categoryId, setCategoryId] = useState("");
  const [severity, setSeverity] = useState<SeverityLabel | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  const { data: categories } = useCategories();
  const claim = useClaimComplaint();

  const queryParams = useMemo<GetOfficerQueueParams>(() => {
    const params: GetOfficerQueueParams = { pageSize: FETCH_SIZE, page: 1 };
    if (tab === "unassigned") params.status = ["SUBMITTED"];
    else if (tab === "active" || tab === "mine") params.status = ACTIVE_STATUSES;
    if (tab === "overdue") params.slaLabel = "OVERDUE";
    if (categoryId) params.categoryId = categoryId;
    if (severity) params.severityLabel = severity;
    return params;
  }, [tab, categoryId, severity]);

  const { data, isLoading } = useOfficerQueue(queryParams);

  const rows = useMemo(() => {
    let items = data?.data ?? [];
    if (tab === "mine" && user) {
      items = items.filter((c) => c.assignedOfficerId === user.id);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (c) => c.id.toLowerCase().includes(q) || c.category.name.toLowerCase().includes(q),
      );
    }
    return items;
  }, [data, tab, user, search]);

  const total = rows.length;
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageIds = paged.map((c) => c.id);
  const allSelectedOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function resetForFilterChange() {
    setPage(1);
    setSelected(new Set());
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleClaim(complaintId: string) {
    try {
      await claim.mutateAsync(complaintId);
      toast({
        title: "Complaint claimed",
        description: "It's now in your evidence-review queue.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't claim this complaint",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-display-sm font-semibold text-ink">
          Complaint Queue
        </h1>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as QueueTab);
          resetForFilterChange();
        }}
      >
        <TabsList>
          {(Object.keys(TAB_LABELS) as QueueTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="queue-search">Search</Label>
          <Input
            id="queue-search"
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            placeholder="Complaint ID or category…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-category">Category</Label>
          <Select
            id="queue-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              resetForFilterChange();
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
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-severity">Severity</Label>
          <Select
            id="queue-severity"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as SeverityLabel | "");
              resetForFilterChange();
            }}
          >
            <option value="">All severities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </Select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bg-brand/10 border-brand/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="text-sm font-medium text-ink">{selected.size} selected</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="size-4" aria-hidden="true" />
              Clear
            </Button>
            <Button size="sm" onClick={() => setBatchOpen(true)}>
              Batch update status…
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No complaints match"
          description="Try a different tab or filter."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelectedOnPage}
                    onChange={toggleSelectAll}
                  />
                </TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Severity</TableHeaderCell>
                <TableHeaderCell>SLA</TableHeaderCell>
                <TableHeaderCell>Assigned</TableHeaderCell>
                <TableHeaderCell>Filed</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.length === 0 ? (
                <DataTableEmpty colSpan={8}>
                  <p className="text-ink-muted text-sm">No complaints on this page.</p>
                </DataTableEmpty>
              ) : (
                paged.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${c.id}`}
                        checked={selected.has(c.id)}
                        onChange={() => toggleRow(c.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/officer/queue/${c.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <DynamicIcon
                          icon={iconForCategory(c.category.name)}
                          className="text-ink-faint size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="font-medium text-ink">{c.category.name}</span>
                        <span className="text-ink-faint font-mono text-xs">{c.id}</span>
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
                      {c.assignedOfficerId == null
                        ? "Unassigned"
                        : c.assignedOfficerId === user?.id
                          ? "You"
                          : `Officer #${c.assignedOfficerId}`}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {relativeTime(c.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "SUBMITTED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={claim.isPending}
                          onClick={() => handleClaim(c.id)}
                        >
                          Claim
                        </Button>
                      ) : (
                        <Link
                          to={`/officer/queue/${c.id}`}
                          className="text-brand text-sm font-medium hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}

      <BatchStatusModal
        open={batchOpen}
        onClose={() => {
          setBatchOpen(false);
          setSelected(new Set());
        }}
        target={{ type: "ids", complaintIds: [...selected] }}
        count={selected.size}
      />
    </div>
  );
}
