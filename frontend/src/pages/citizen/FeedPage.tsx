import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ImageOff, Link2, List, MapPin, MapPinned, Rss } from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { StatusPill, SeverityPill } from "@/components/ui/pills";
import { MiniMap } from "@/components/ui/MiniMap";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { useFeed } from "@/hooks/useFeed";
import { useCategories } from "@/hooks/useCategories";
import { useUpvoteComplaint } from "@/hooks/useUpvoteComplaint";
import { useLandmark } from "@/hooks/useLandmark";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { useSearchParamState } from "@/hooks/useSearchParamState";
import { cn } from "@/lib/utils";
import type { FeedItem, SeverityLabel } from "@/types/api";

const PAGE_SIZE = 12;
// Bumped only while the (client-only) severity filter is active — the API
// has no `severityLabel` query param for /feed — so the shown count and
// pagination stay honest against the *filtered* set instead of the
// unfiltered server total.
const FETCH_SIZE = 100;
const RESOLVED_STATUSES = new Set(["CLOSED", "REJECTED", "UNRESOLVABLE"]);

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "-createdAt", label: "Newest first" },
  { value: "createdAt", label: "Oldest first" },
  { value: "-severity", label: "Severity (highest first)" },
  { value: "-upvotes", label: "Most upvoted" },
];

const SEVERITY_OPTIONS: { value: SeverityLabel | ""; label: string }[] = [
  { value: "", label: "All severities" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const boolCodec = {
  serialize: (v: boolean) => (v ? "1" : undefined),
  deserialize: (raw: string) => raw === "1",
};

export function FeedPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [severity, setSeverity] = useSearchParamState<SeverityLabel | "">("severity", "");
  const [sort, setSort] = useSearchParamState("sort", "-createdAt");
  const [includeResolved, setIncludeResolved] = useSearchParamState(
    "resolved",
    false,
    boolCodec,
  );
  const [highlightId, setHighlightId] = useSearchParamState("highlight", "");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "map">("list");
  const [justUpvoted, setJustUpvoted] = useState<Set<string>>(new Set());
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const { data: categories } = useCategories();
  const { data: zones } = useZones();

  const hasSeverityFilter = severity !== "";

  const { data, isLoading } = useFeed({
    page: hasSeverityFilter ? 1 : page,
    pageSize: hasSeverityFilter ? FETCH_SIZE : PAGE_SIZE,
    sort,
    includeResolved,
    categoryId: categoryId || undefined,
  });

  const zoneName = zones?.find((z) => z.id === user?.zoneId)?.name;
  const allItems = useMemo(() => data?.data ?? [], [data]);
  const filtered = useMemo(
    () => (severity ? allItems.filter((i) => i.severityLabel === severity) : allItems),
    [allItems, severity],
  );
  const total = hasSeverityFilter ? filtered.length : (data?.pagination.totalItems ?? 0);
  const items = hasSeverityFilter
    ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filtered;
  const hasFilters = categoryId !== "" || severity !== "" || includeResolved;

  const pins = items
    .filter(
      (i): i is FeedItem & { latitude: number; longitude: number } =>
        i.latitude != null && i.longitude != null,
    )
    .map((i) => ({
      id: i.id,
      lat: i.latitude,
      lng: i.longitude,
      label: i.severityLabel
        ? `${i.category.name} · ${i.severityLabel}`
        : i.category.name,
    }));

  function resetPage() {
    setPage(1);
  }

  // Scroll to / briefly highlight a card shared via "Copy link".
  useEffect(() => {
    if (!highlightId || isLoading) return;
    const el = cardRefs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timeout = setTimeout(() => setHighlightId(""), 2500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, isLoading, items.length]);

  async function copyLink(item: FeedItem) {
    const params = new URLSearchParams(window.location.search);
    params.set("highlight", item.id);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: "Shareable link to this feed card.",
        variant: "success",
      });
    } catch {
      toast({ title: "Couldn't copy link", variant: "error" });
    }
  }

  function markUpvoted(id: string) {
    setJustUpvoted((prev) => new Set(prev).add(id));
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-sm font-semibold text-ink">Feed</h1>
          <p className="text-ink-muted mt-1 flex items-center gap-1.5 text-sm">
            <MapPin className="size-4" aria-hidden="true" />
            {zoneName
              ? `What's being reported in ${zoneName}`
              : "What's being reported in your zone"}
          </p>
        </div>
        <div className="border-line inline-flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            aria-label="List view"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors",
              view === "list"
                ? "bg-brand text-brand-fg"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <List className="size-4" aria-hidden="true" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            aria-pressed={view === "map"}
            aria-label="Map view"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors",
              view === "map" ? "bg-brand text-brand-fg" : "text-ink-muted hover:text-ink",
            )}
          >
            <MapPinned className="size-4" aria-hidden="true" />
            Map
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="feed-category-filter">Category</Label>
          <Combobox
            id="feed-category-filter"
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v);
              resetPage();
            }}
            options={[
              { value: "", label: "All categories" },
              ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="feed-severity-filter">Severity</Label>
          <Combobox
            id="feed-severity-filter"
            value={severity}
            onChange={(v) => {
              setSeverity(v as SeverityLabel | "");
              resetPage();
            }}
            options={SEVERITY_OPTIONS}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="feed-sort">Sort by</Label>
          <Combobox
            id="feed-sort"
            value={sort}
            onChange={(v) => {
              setSort(v);
              resetPage();
            }}
            options={SORT_OPTIONS}
          />
        </div>
        <Checkbox
          id="feed-include-resolved"
          label="Include closed & rejected"
          checked={includeResolved}
          onChange={(e) => {
            setIncludeResolved(e.target.checked);
            resetPage();
          }}
          className="mb-3"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={
            hasFilters ? "No complaints match these filters" : "Nothing reported yet"
          }
          description={
            hasFilters
              ? "Try a different category or include closed complaints."
              : "Once neighbors start reporting issues in your zone, they'll show up here."
          }
          className="rounded-lg border border-line bg-surface"
        />
      ) : view === "map" ? (
        pins.length > 0 ? (
          <MiniMap pins={pins} height={420} zoom={13} />
        ) : (
          <EmptyState
            icon={MapPinned}
            title="No mapped locations on this page"
            description="None of the currently loaded complaints have location data."
            className="rounded-lg border border-line bg-surface"
          />
        )
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                highlighted={item.id === highlightId}
                justUpvoted={justUpvoted.has(item.id)}
                onUpvoted={() => markUpvoted(item.id)}
                onCopyLink={() => copyLink(item)}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(item.id, el);
                  else cardRefs.current.delete(item.id);
                }}
              />
            ))}
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

function FeedCard({
  item,
  highlighted,
  justUpvoted,
  onUpvoted,
  onCopyLink,
  cardRef,
}: {
  item: FeedItem;
  highlighted: boolean;
  justUpvoted: boolean;
  onUpvoted: () => void;
  onCopyLink: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const upvote = useUpvoteComplaint();
  const { data: landmark, isLoading: landmarkLoading } = useLandmark(
    item.latitude,
    item.longitude,
  );
  const resolved = RESOLVED_STATUSES.has(item.status);
  const displayedUpvoteCount =
    item.upvoteCount + (justUpvoted && !item.hasUpvoted ? 1 : 0);

  function handleUpvote() {
    onUpvoted();
    upvote.mutate(item.id);
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-surface transition-shadow",
        highlighted ? "border-brand ring-brand/40 ring-2" : "border-line",
      )}
    >
      <div className="bg-surface-hover relative aspect-video w-full overflow-hidden">
        {item.photoUrl ? (
          <img src={item.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageOff className="text-ink-faint size-8" aria-hidden="true" />
          </div>
        )}
        {resolved && (
          <div className="absolute top-2 left-2">
            <StatusPill status={item.status} />
          </div>
        )}
        <button
          type="button"
          onClick={onCopyLink}
          aria-label="Copy link to this complaint"
          className="bg-surface/90 text-ink-muted hover:text-ink absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full shadow-sm"
        >
          <Link2 className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <DynamicIcon
            icon={iconForCategory(item.category.name)}
            className="text-ink-faint size-4 shrink-0"
            aria-hidden="true"
          />
          <p className="truncate text-sm font-medium text-ink">{item.category.name}</p>
        </div>

        {item.latitude != null && item.longitude != null && (
          <div className="text-ink-faint flex items-center gap-1.5 text-xs">
            <MapPinned className="size-3.5 shrink-0" aria-hidden="true" />
            {landmarkLoading ? (
              <Skeleton className="h-3 w-32" />
            ) : (
              <span className="truncate">{landmark ?? "Location unavailable"}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {!resolved && <StatusPill status={item.status} />}
          {item.severityLabel && <SeverityPill severity={item.severityLabel} />}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-ink-faint text-xs">
            {item.createdAt ? relativeTime(item.createdAt) : null}
          </p>
          <button
            type="button"
            disabled={item.hasUpvoted || justUpvoted || upvote.isPending}
            onClick={handleUpvote}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              item.hasUpvoted || justUpvoted
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-line text-ink-muted hover:bg-surface-hover hover:text-ink",
              "disabled:pointer-events-none",
            )}
          >
            <ArrowUp className="size-3.5" aria-hidden="true" />
            {displayedUpvoteCount}
          </button>
        </div>
      </div>
    </div>
  );
}
