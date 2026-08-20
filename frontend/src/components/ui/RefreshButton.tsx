import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export interface RefreshButtonProps {
  /** Usually a react-query `refetch`. The returned promise is not awaited — `refreshing` drives the spinner. */
  onRefresh: () => unknown;
  /** Usually react-query's `isFetching`, so background refetches spin this too. */
  refreshing?: boolean;
  /** Names the thing being refreshed, e.g. "complaints". Used in the tooltip and the accessible name. */
  what?: string;
  /** Ghost by default — see the note on styling below. */
  variant?: ButtonVariant;
  /** Show a text label beside the icon instead of an icon-only control. */
  withLabel?: boolean;
  className?: string;
}

/**
 * Manual "fetch this again" control for any view backed by a query.
 *
 * Every list in the app is a cached react-query read, so what is on screen can
 * legitimately be a few seconds to a few minutes old — an officer watching a
 * queue or an admin watching a dispute list has no way to tell, and no way to
 * ask for a fresh copy short of reloading the whole page (which also throws
 * away their filters and their scroll position).
 *
 * **Styling.** Ghost, 32px, muted icon — deliberately quiet. This is a
 * secondary affordance sitting next to a page heading or among filter
 * controls, and the first version of it used the bordered `outline` variant,
 * which read as a primary control and drew the eye away from the heading it
 * was attached to. It matches the icon buttons the dashboards already used
 * (which now share this component) so there is one refresh control in the app
 * rather than two that look different.
 *
 * While a refresh is in flight the control disables itself, so a frustrated
 * double-click cannot queue a second request, but the icon keeps spinning so
 * the click is visibly acknowledged.
 */
export function RefreshButton({
  onRefresh,
  refreshing = false,
  variant = "ghost",
  withLabel = false,
  className,
}: RefreshButtonProps) {
  const { t } = useTranslation();
  const label = t("common.refreshNow");

  const button = (
    <Button
      type="button"
      variant={variant}
      size={withLabel ? "sm" : "icon"}
      onClick={() => onRefresh()}
      disabled={refreshing}
      aria-label={label}
      className={cn(
        withLabel ? "gap-1.5" : "text-ink-faint hover:text-ink size-8 shrink-0",
        className,
      )}
    >
      <RefreshCw
        className={cn("size-4 shrink-0", refreshing && "animate-spin")}
        aria-hidden="true"
      />
      {withLabel && <span>{label}</span>}
    </Button>
  );

  // An icon-only control needs the tooltip to explain itself; one with a
  // visible label already says what it does.
  return withLabel ? button : <Tooltip content={label}>{button}</Tooltip>;
}
