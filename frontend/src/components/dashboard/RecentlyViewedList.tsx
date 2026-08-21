import { useTranslation } from "react-i18next";
import { History, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { RecentItem } from "@/hooks/useRecentlyViewed";
import { relativeTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export interface RecentlyViewedListProps {
  items: RecentItem[];
  onClear?: () => void;
  className?: string;
}

/**
 * Shared "recently viewed" widget for the three dashboards — reads a
 * localStorage-backed list (`useRecentlyViewed`) recorded when a detail
 * page was opened; clicking an entry just navigates, no data is refetched
 * by this component itself.
 */
export function RecentlyViewedList({
  items,
  onClear,
  className,
}: RecentlyViewedListProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <section className={cn("rounded-lg border border-line bg-surface p-5", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-base font-semibold text-ink">
          <History className="text-ink-faint size-4" aria-hidden="true" />
          {t("recentlyViewed.title")}
        </h2>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-ink-faint hover:text-ink flex items-center gap-1 text-xs"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("notifications.clear")}
          </button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.href}
              className="hover:bg-surface-hover -mx-1 flex items-center justify-between gap-3 rounded-md px-1 py-2 transition-colors"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                {item.sublabel && (
                  <p className="text-ink-faint truncate text-xs">{item.sublabel}</p>
                )}
              </div>
              <span className="text-ink-faint shrink-0 text-xs">
                {relativeTime(item.viewedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
