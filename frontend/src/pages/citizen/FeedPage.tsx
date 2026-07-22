import { useState } from "react";
import { ArrowUp, ImageOff, MapPin, MapPinned, Rss } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { StatusPill, SeverityPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { useFeed } from "@/hooks/useFeed";
import { useCategories } from "@/hooks/useCategories";
import { useUpvoteComplaint } from "@/hooks/useUpvoteComplaint";
import { useLandmark } from "@/hooks/useLandmark";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/types/api";

const PAGE_SIZE = 12;
const RESOLVED_STATUSES = new Set(["CLOSED", "REJECTED", "UNRESOLVABLE"]);

export function FeedPage() {
  const { user } = useAuth();
  const [categoryId, setCategoryId] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [page, setPage] = useState(1);

  const { data: categories } = useCategories();
  const { data: zones } = useZones();
  const { data, isLoading } = useFeed({
    page,
    pageSize: PAGE_SIZE,
    sort: "-createdAt",
    includeResolved,
    categoryId: categoryId || undefined,
  });

  const zoneName = zones?.find((z) => z.id === user?.zoneId)?.name;
  const items = data?.data ?? [];
  const hasFilters = categoryId !== "" || includeResolved;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">Feed</h1>
        <p className="text-ink-muted mt-1 flex items-center gap-1.5 text-sm">
          <MapPin className="size-4" aria-hidden="true" />
          {zoneName ? `What's being reported in ${zoneName}` : "What's being reported in your zone"}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="feed-category-filter">Category</Label>
          <Select
            id="feed-category-filter"
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
        <Checkbox
          id="feed-include-resolved"
          label="Include closed & rejected"
          checked={includeResolved}
          onChange={(e) => {
            setIncludeResolved(e.target.checked);
            setPage(1);
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
          title={hasFilters ? "No complaints match these filters" : "Nothing reported yet"}
          description={
            hasFilters
              ? "Try a different category or include closed complaints."
              : "Once neighbors start reporting issues in your zone, they'll show up here."
          }
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <FeedCard key={item.id} item={item} />
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

function FeedCard({ item }: { item: FeedItem }) {
  const upvote = useUpvoteComplaint();
  const { data: landmark, isLoading: landmarkLoading } = useLandmark(
    item.latitude,
    item.longitude,
  );
  const resolved = RESOLVED_STATUSES.has(item.status);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
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
            disabled={item.hasUpvoted || upvote.isPending}
            onClick={() => upvote.mutate(item.id)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              item.hasUpvoted
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-line text-ink-muted hover:bg-surface-hover hover:text-ink",
              "disabled:pointer-events-none",
            )}
          >
            <ArrowUp className="size-3.5" aria-hidden="true" />
            {item.upvoteCount}
          </button>
        </div>
      </div>
    </div>
  );
}
