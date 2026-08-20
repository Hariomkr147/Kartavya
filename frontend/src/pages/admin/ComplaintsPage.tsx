import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Copy, Download, MoreHorizontal, Search, X } from "lucide-react";
import { DatePicker } from "@/components/ui/DatePicker";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
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
import { useAdminComplaints } from "@/hooks/useAdminComplaints";
import { useCategories } from "@/hooks/useCategories";
import { useZones } from "@/hooks/useZones";
import { useOverrideComplaint } from "@/hooks/useOverrideComplaint";
import { useSearchParamState, csvCodec } from "@/hooks/useSearchParamState";
import { exportRowsToCsv } from "@/lib/csvExport";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { exportComplaintsCsv, type GetAdminComplaintsParams } from "@/services/admin";
import { ApiRequestError } from "@/services/http";
import type { TranslationKey } from "@/i18n";
import type { Complaint, ComplaintStatus, SlaLabel } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

const ALL_STATUSES: ComplaintStatus[] = [
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

const SORT_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "-createdAt", labelKey: "adminComplaints.sort.newestFiled" },
  { value: "createdAt", labelKey: "adminComplaints.sort.oldestFiled" },
  { value: "-updatedAt", labelKey: "adminComplaints.sort.recentlyUpdated" },
  { value: "updatedAt", labelKey: "adminComplaints.sort.leastRecentlyUpdated" },
  { value: "-severity", labelKey: "adminComplaints.sort.severityHigh" },
  { value: "severity", labelKey: "adminComplaints.sort.severityLow" },
  { value: "-sla", labelKey: "adminComplaints.sort.slaMost" },
  { value: "sla", labelKey: "adminComplaints.sort.slaLeast" },
  { value: "-upvotes", labelKey: "adminComplaints.sort.upvotesMost" },
  { value: "upvotes", labelKey: "adminComplaints.sort.upvotesLeast" },
];

function dateSerialize(d: Date | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}
function dateDeserialize(raw: string): Date | undefined {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function pageSerialize(p: number): string {
  return String(p);
}
function pageDeserialize(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

const PAGE_SIZE = 15;

export function AdminComplaintsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const { toast } = useToast();
  const [zoneId, setZoneId] = useSearchParamState("zone", "");
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [statusList, setStatusList] = useSearchParamState<string[]>(
    "status",
    [],
    csvCodec,
  );
  const [slaLabel, setSlaLabel] = useSearchParamState<SlaLabel | "">("sla", "");
  const [dateFrom, setDateFrom] = useSearchParamState<Date | undefined>(
    "from",
    undefined,
    {
      serialize: dateSerialize,
      deserialize: dateDeserialize,
    },
  );
  const [dateTo, setDateTo] = useSearchParamState<Date | undefined>("to", undefined, {
    serialize: dateSerialize,
    deserialize: dateDeserialize,
  });
  const [sort, setSort] = useSearchParamState("sort", "-createdAt");
  const [search, setSearch] = useSearchParamState("q", "");
  // In the URL like every other filter here — so "Copy link to this view"
  // (below) reopens on the same page instead of always resetting to page 1.
  const [page, setPage] = useSearchParamState("page", 1, {
    serialize: pageSerialize,
    deserialize: pageDeserialize,
  });
  const [exporting, setExporting] = useState(false);
  // Bypasses the per-field `useSearchParamState` setters below for the
  // "clear all" case: each of those setters closes over its own stale
  // snapshot of the URL from this render, so calling several of them back
  // to back (one per filter) makes each call clobber the previous one's
  // change instead of composing — only the last field actually clears.
  // One functional `setSearchParams` update removes every filter key in a
  // single atomic navigation instead.
  const [, setRawSearchParams] = useSearchParams();
  const [reassigningComplaint, setReassigningComplaint] = useState<Complaint | null>(
    null,
  );

  const statuses = useMemo(() => new Set(statusList as ComplaintStatus[]), [statusList]);

  const { data: zones } = useZones();
  const { data: categories } = useCategories();

  const filters = useMemo<Omit<GetAdminComplaintsParams, "page" | "pageSize">>(
    () => ({
      zoneId: zoneId || undefined,
      categoryId: categoryId || undefined,
      status: statusList.length > 0 ? (statusList as ComplaintStatus[]) : undefined,
      slaLabel: slaLabel || undefined,
      dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
      dateTo: dateTo ? dateTo.toISOString() : undefined,
      sort,
    }),
    [zoneId, categoryId, statusList, slaLabel, dateFrom, dateTo, sort],
  );

  const { data, isLoading, isFetching, refetch } = useAdminComplaints({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = useMemo(() => {
    const fetched = data?.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return fetched;
    return fetched.filter(
      (c) =>
        c.id.toLowerCase().includes(term) ||
        c.category.name.toLowerCase().includes(term) ||
        (c.zoneName ?? "").toLowerCase().includes(term),
    );
  }, [data, search]);

  function resetPage() {
    setPage(1);
  }

  function toggleStatus(status: ComplaintStatus) {
    const next = new Set(statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setStatusList([...next]);
    resetPage();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await exportComplaintsCsv(filters);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "complaints.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: t("adminComplaints.exportFailed"),
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  function handleExportVisiblePage() {
    exportRowsToCsv("admin-complaints-page.csv", rows, [
      { header: t("adminComplaints.columns.id"), accessor: (c: Complaint) => c.id },
      { header: t("filters.category"), accessor: (c: Complaint) => c.category.name },
      { header: t("filters.zone"), accessor: (c: Complaint) => c.zoneName ?? "" },
      {
        header: t("filters.status"),
        accessor: (c: Complaint) => t(`status.${c.status}`),
      },
      {
        header: t("filters.severity"),
        accessor: (c: Complaint) => (c.severityLabel ? t(`severity.${c.severityLabel}`) : ""),
      },
      {
        header: t("columns.sla"),
        accessor: (c: Complaint) => (c.slaLabel ? t(`sla.${c.slaLabel}`) : ""),
      },
      { header: t("adminComplaints.columns.filedAt"), accessor: (c: Complaint) => c.createdAt },
      {
        header: t("adminComplaints.columns.officerId"),
        accessor: (c: Complaint) => c.assignedOfficerId ?? "",
      },
    ]);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({
        title: t("feed.linkCopied"),
        description: t("adminComplaints.linkCopiedBody"),
        variant: "success",
      });
    } catch {
      toast({ title: t("feed.linkCopyFailed"), variant: "error" });
    }
  }

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (zoneId) {
      chips.push({
        key: "zone",
        label: t("adminComplaints.chips.zone", {
          zone: zones?.find((z) => z.id === zoneId)?.name ?? zoneId,
        }),
        onRemove: () => {
          setZoneId("");
          resetPage();
        },
      });
    }
    if (categoryId) {
      chips.push({
        key: "category",
        label: t("adminComplaints.chips.category", {
          category: categories?.find((c) => c.id === categoryId)?.name ?? categoryId,
        }),
        onRemove: () => {
          setCategoryId("");
          resetPage();
        },
      });
    }
    if (slaLabel) {
      chips.push({
        key: "sla",
        label: t("adminComplaints.chips.sla", { sla: t(`sla.${slaLabel}`) }),
        onRemove: () => {
          setSlaLabel("");
          resetPage();
        },
      });
    }
    if (dateFrom) {
      chips.push({
        key: "from",
        label: t("adminComplaints.chips.from", { date: dateFrom.toLocaleDateString(locale) }),
        onRemove: () => {
          setDateFrom(undefined);
          resetPage();
        },
      });
    }
    if (dateTo) {
      chips.push({
        key: "to",
        label: t("adminComplaints.chips.to", { date: dateTo.toLocaleDateString(locale) }),
        onRemove: () => {
          setDateTo(undefined);
          resetPage();
        },
      });
    }
    if (search.trim()) {
      chips.push({
        key: "q",
        label: t("adminComplaints.chips.search", { search: search.trim() }),
        onRemove: () => {
          setSearch("");
          resetPage();
        },
      });
    }
    for (const status of statuses) {
      chips.push({
        key: `status-${status}`,
        label: t(`status.${status}`),
        onRemove: () => toggleStatus(status),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, categoryId, slaLabel, dateFrom, dateTo, search, statuses, zones, categories, t, locale]);

  function handleClearAllFilters() {
    setRawSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["zone", "category", "status", "sla", "from", "to", "q"]) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
    resetPage();
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">
              {t("nav.complaints")}
            </h1>
            <RefreshButton
              onRefresh={refetch}
              refreshing={isFetching}
              what="complaints"
            />
          </div>
          <p className="text-ink-muted mt-1 text-sm">{t("adminComplaints.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            <Copy className="size-4" aria-hidden="true" />
            {t("adminComplaints.copyLink")}
          </Button>
          <Dropdown align="end">
            <DropdownTrigger>
              <Button variant="outline" size="sm" loading={exporting}>
                <Download className="size-4" aria-hidden="true" />
                {t("adminComplaints.export")}
              </Button>
            </DropdownTrigger>
            <DropdownMenu>
              <DropdownItem onSelect={handleExportVisiblePage}>
                {t("adminComplaints.exportVisible")}
              </DropdownItem>
              <DropdownItem onSelect={handleExport}>
                {t("adminComplaints.exportAll")}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="bg-surface-hover text-ink-muted hover:text-ink inline-flex items-center gap-1 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-medium"
            >
              {chip.label}
              <X className="size-3.5 shrink-0" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={handleClearAllFilters}
            className="text-brand text-xs font-medium hover:underline"
          >
            {t("adminComplaints.clearAll")}
          </button>
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="zone-filter">{t("filters.zone")}</Label>
            <Combobox
              id="zone-filter"
              value={zoneId}
              onChange={(v) => {
                setZoneId(v);
                resetPage();
              }}
              options={[
                { value: "", label: t("filters.allZones") },
                ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
              ]}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="category-filter">{t("filters.category")}</Label>
            <Combobox
              id="category-filter"
              value={categoryId}
              placeholder={t("filters.allCategories")}
              onChange={(next) => {
                setCategoryId(next);
                resetPage();
              }}
              options={[
                { value: "", label: t("filters.allCategories") },
                ...(categories?.map((c) => ({
                  value: c.id,
                  label: c.name,
                  icon: (
                    <DynamicIcon
                      icon={iconForCategory(c.name)}
                      className="size-4 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                  ),
                })) ?? []),
              ]}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="sla-filter">{t("columns.sla")}</Label>
            <Combobox
              id="sla-filter"
              value={slaLabel}
              onChange={(v) => {
                setSlaLabel(v as SlaLabel | "");
                resetPage();
              }}
              options={[
                { value: "", label: t("adminUsers.all") },
                { value: "ON_TIME", label: t("sla.ON_TIME") },
                { value: "DELAYED", label: t("sla.DELAYED") },
                { value: "OVERDUE", label: t("sla.OVERDUE") },
              ]}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-from">{t("filters.from")}</Label>
            <DatePicker
              id="date-from"
              value={dateFrom}
              maxDate={dateTo}
              onChange={(date) => {
                setDateFrom(date);
                resetPage();
              }}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-to">{t("filters.to")}</Label>
            <DatePicker
              id="date-to"
              value={dateTo}
              minDate={dateFrom}
              onChange={(date) => {
                setDateTo(date);
                resetPage();
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="sort-order">{t("filters.sortBy")}</Label>
            <Combobox
              id="sort-order"
              value={sort}
              onChange={(v) => {
                setSort(v);
                resetPage();
              }}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="complaint-search">{t("adminUsers.searchPage")}</Label>
            <Input
              id="complaint-search"
              placeholder={t("adminComplaints.searchPlaceholder")}
              value={search}
              leftIcon={<Search className="size-4" aria-hidden="true" />}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label id="status-filter-label">{t("filters.status")}</Label>
          <div
            role="group"
            aria-labelledby="status-filter-label"
            className="flex flex-wrap gap-1.5"
          >
            {ALL_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={statuses.has(status)}
                onClick={() => toggleStatus(status)}
                className={
                  statuses.has(status)
                    ? "bg-brand text-brand-fg rounded-full px-2.5 py-1 text-xs font-medium"
                    : "bg-surface-hover text-ink-muted hover:text-ink rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                }
              >
                {t(`status.${status}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("officerQueue.noMatch")}
          description={t("adminComplaints.noMatchBody")}
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          {data && (
            <p className="text-ink-muted text-sm">
              <span className="font-medium text-ink">{data.pagination.totalItems}</span>{" "}
              matching complaint{data.pagination.totalItems === 1 ? "" : "s"}.
            </p>
          )}
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-14">
                  {t("columns.photo")}
                </TableHeaderCell>
                <TableHeaderCell>{t("filters.category")}</TableHeaderCell>
                <TableHeaderCell>{t("filters.zone")}</TableHeaderCell>
                <TableHeaderCell>{t("filters.status")}</TableHeaderCell>
                <TableHeaderCell>{t("filters.severity")}</TableHeaderCell>
                <TableHeaderCell>{t("columns.sla")}</TableHeaderCell>
                <TableHeaderCell>{t("columns.upvotes")}</TableHeaderCell>
                <TableHeaderCell>{t("roles.officer")}</TableHeaderCell>
                <TableHeaderCell>{t("columns.filed")}</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  {t("columns.actions")}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <DataTableEmpty colSpan={10}>—</DataTableEmpty>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to={`/admin/complaints/${c.id}`}
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
                        to={`/admin/complaints/${c.id}`}
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
                    <TableCell className="text-ink-muted text-sm">{c.zoneName}</TableCell>
                    <TableCell>
                      <StatusPill status={c.status} />
                    </TableCell>
                    <TableCell>
                      {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
                    </TableCell>
                    <TableCell>{c.slaLabel && <SlaPill sla={c.slaLabel} />}</TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {c.upvoteCount ?? 0}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {c.assignedOfficerId == null
                        ? t("officerQueue.tabs.unassigned")
                        : t("statusTimeline.officer", {
                            officerId: c.assignedOfficerId,
                          })}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {relativeTime(c.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Dropdown align="end">
                        <DropdownTrigger>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("common.moreActions")}
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu>
                          <DropdownItem onSelect={() => setReassigningComplaint(c)}>
                            {t("adminComplaints.reassignZone")}
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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

      {reassigningComplaint && (
        <ReassignZoneModal
          complaint={reassigningComplaint}
          onClose={() => setReassigningComplaint(null)}
        />
      )}
    </div>
  );
}

function ReassignZoneModal({
  complaint,
  onClose,
}: {
  complaint: Complaint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: zones } = useZones();
  const override = useOverrideComplaint(complaint.id);
  const [zoneId, setZoneId] = useState(complaint.zoneId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!zoneId || zoneId === complaint.zoneId) {
      setError(t("adminComplaints.chooseDifferentZone"));
      return;
    }
    try {
      await override.mutateAsync({ zoneId, reason: reason.trim() || undefined });
      toast({ title: t("adminComplaints.zoneReassigned"), variant: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errors.generic"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("adminComplaints.reassignTitle", { complaintId: complaint.id })}
      description={t("adminComplaints.reassignBody")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={override.isPending} onClick={handleSave}>
            {t("adminComplaints.reassign")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            role="alert"
            className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        )}
        <div>
          <Label htmlFor="reassign-zone" required>
            {t("adminComplaints.newZone")}
          </Label>
          <Combobox
            id="reassign-zone"
            value={zoneId}
            onChange={setZoneId}
            options={zones?.map((z) => ({ value: z.id, label: z.name })) ?? []}
          />
        </div>
        <div>
          <Label htmlFor="reassign-reason">{t("adminComplaints.reasonRecommended")}</Label>
          <Input
            id="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("adminComplaints.reasonPlaceholder")}
          />
        </div>
      </div>
    </Modal>
  );
}
