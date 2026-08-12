import { RotateCw } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export interface RefreshButtonProps {
  /** Usually a react-query `refetch`. The returned promise is not awaited — `refreshing` drives the spinner. */
  onRefresh: () => unknown;
  /** Usually react-query's `isFetching`, so background refetches spin this too. */
  refreshing?: boolean;
  /** Names the thing being refreshed, e.g. "complaints". Used in the tooltip and the accessible name. */
  what?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
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
 * While a refresh is in flight the control disables itself, so a frustrated
 * double-click cannot queue a second request, but the icon keeps spinning so
 * the click is visibly acknowledged.
 */
export function RefreshButton({
  onRefresh,
  refreshing = false,
  what,
  variant = "outline",
  size = "sm",
  withLabel = false,
  className,
}: RefreshButtonProps) {
  const label = what ? `Refresh ${what}` : "Refresh";

  const button = (
    <Button
      type="button"
      variant={variant}
      size={withLabel ? size : "sm"}
      onClick={() => onRefresh()}
      disabled={refreshing}
      aria-label={label}
      className={cn(!withLabel && "w-8 px-0", className)}
    >
      <RotateCw
        className={cn("size-4 shrink-0", refreshing && "animate-spin")}
        aria-hidden="true"
      />
      {withLabel && <span>Refresh</span>}
    </Button>
  );

  // An icon-only control needs the tooltip to explain itself; one with a
  // visible label already says what it does.
  return withLabel ? button : <Tooltip content={label}>{button}</Tooltip>;
}
