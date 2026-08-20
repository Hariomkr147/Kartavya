import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, List, Map as MapIcon, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { SeverityPill } from "@/components/ui/pills";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { MiniMap, type MiniMapPin } from "@/components/ui/MiniMap";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useClusters } from "@/hooks/useClusters";
import { useSearchParamState } from "@/hooks/useSearchParamState";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import type { ComplaintStatus, SeverityLabel } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

const PAGE_SIZE = 12;
// GET /clusters has no category/severity/search params, so — mirroring the
// same client-side pattern OfficerQueuePage uses for its own missing
// filters — this fetches a modestly larger working set once and filters/
// paginates it entirely client-side below.
const FETCH_SIZE = 60;

const STATUS_ORDER: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "REOPENED",
  "CLOSED",
  "REJECTED",
  "UNRESOLVABLE",
];

const SEVERITY_VALUES: SeverityLabel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

type ClusterView = "list" | "map";

function isClusterView(value: string): value is ClusterView {
  return value === "list" || value === "map";
}

export function OfficerClustersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [view, setView] = useSearchParamState<ClusterView>("view", "list", {
    serialize: (v) => (v === "list" ? undefined : v),
    deserialize: (raw) => (isClusterView(raw) ? raw : "list"),
  });
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [severity, setSeverity] = useSearchParamState<SeverityLabel | "">(
    "severity",
    "",
    {
      serialize: (v) => (v ? v : undefined),
      deserialize: (raw) =>
        SEVERITY_VALUES.includes(raw as SeverityLabel) ? (raw as SeverityLabel) : "",
    },
  );
  const [search, setSearch] = useSearchParamState("q", "");

  const { data, isLoading, isFetching, refetch } = useClusters({
    page: 1,
    pageSize: FETCH_SIZE,
  });
  const loaded = useMemo(() => data?.data ?? [], [data]);

  const categoryOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const cluster of loaded) byId.set(cluster.category.id, cluster.category.name);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [loaded]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return loaded.filter((cluster) => {
      if (categoryId && cluster.category.id !== categoryId) return false;
      if (severity && cluster.severityLabel !== severity) return false;
      if (
        q &&
        !cluster.id.toLowerCase().includes(q) &&
        !cluster.category.name.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [loaded, categoryId, severity, search]);

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const mapPins: MiniMapPin[] = filtered.map((cluster) => ({
    id: cluster.id,
    lat: cluster.centroidLat,
    lng: cluster.centroidLng,
    label: `${cluster.category.name} (${cluster.reportCount})`,
  }));

  function resetForFilterChange() {
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">
              {t("nav.clusters")}
            </h1>
            <RefreshButton onRefresh={refetch} refreshing={isFetching} what="clusters" />
          </div>
          <p className="text-ink-muted mt-1 text-sm">{t("clusters.officerSubtitle")}</p>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as ClusterView)}>
          <TabsList>
            <TabsTrigger value="list">
              <span className="inline-flex items-center gap-1.5">
                <List className="size-3.5" aria-hidden="true" />
                {t("feed.list")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="map">
              <span className="inline-flex items-center gap-1.5">
                <MapIcon className="size-3.5" aria-hidden="true" />
                {t("feed.map")}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="cluster-search">{t("filters.search")}</Label>
          <Input
            id="cluster-search"
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            placeholder={t("clusters.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetForFilterChange();
            }}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="cluster-category">{t("filters.category")}</Label>
          <Combobox
            id="cluster-category"
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              resetForFilterChange();
            }}
            options={[
              { value: "", label: t("filters.allCategories") },
              ...categoryOptions.map(([id, name]) => ({ value: id, label: name })),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="cluster-severity">{t("filters.severity")}</Label>
          <Combobox
            id="cluster-severity"
            value={severity}
            onChange={(value) => {
              setSeverity(value as SeverityLabel | "");
              resetForFilterChange();
            }}
            options={[
              { value: "", label: t("filters.allSeverities") },
              ...SEVERITY_VALUES.map((value) => ({
                value,
                label: t(`severity.${value}`),
              })),
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t("clusters.noMatch")}
          description={t("clusters.noMatchBody")}
          className="rounded-lg border border-line bg-surface"
        />
      ) : view === "map" ? (
        <MiniMap
          pins={mapPins}
          height={420}
          onPinClick={(id) => navigate(`/officer/clusters/${id}`)}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {paged.map((cluster) => {
              const statuses = STATUS_ORDER.filter((s) => cluster.statusSummary[s]);
              return (
                <Link
                  key={cluster.id}
                  to={`/officer/clusters/${cluster.id}`}
                  className="space-y-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="bg-surface-hover flex size-9 shrink-0 items-center justify-center rounded-full">
                        <DynamicIcon
                          icon={iconForCategory(cluster.category.name)}
                          className="text-ink-muted size-4"
                          aria-hidden="true"
                        />
                      </span>
                      <div>
                        <p className="font-medium text-ink">{cluster.category.name}</p>
                        <p className="text-ink-faint font-mono text-xs">{cluster.id}</p>
                      </div>
                    </div>
                    <SeverityPill severity={cluster.severityLabel} />
                  </div>

                  <div className="text-ink-muted flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>{t("clusters.reports", { count: cluster.reportCount })}</span>
                    <span>
                      {t("clusters.uniqueReporters", {
                        count: cluster.uniqueReporterCount,
                      })}
                    </span>
                    <span>{relativeTime(cluster.createdAt)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {statuses.map((status) => (
                      <span
                        key={status}
                        className="bg-surface-hover text-ink-muted rounded-full px-2 py-0.5 text-xs"
                      >
                        {t("clusters.statusCount", {
                          count: cluster.statusSummary[status],
                          status: t(`status.${status}`).toLowerCase(),
                        })}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
