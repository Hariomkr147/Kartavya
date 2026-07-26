import { Bell, CheckCircle2, AlertTriangle, XCircle, Info, Trash2 } from "lucide-react";
import { useToast, type ToastVariant } from "@/components/ui/Toast";
import { Dropdown, DropdownTrigger, DropdownMenu } from "@/components/ui/Dropdown";
import { relativeTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const VARIANT_ICON: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: "text-ink",
  success: "text-status-resolved",
  warning: "text-status-needs_more_evidence",
  error: "text-status-rejected",
};

/** Session log of this app's own toasts — nothing persists here across a reload, it's a convenience recall, not a real notification backend. */
export function NotificationCenter() {
  const { history, unreadCount, markHistoryRead, clearHistory } = useToast();

  return (
    <Dropdown align="end">
      <DropdownTrigger>
        <button
          type="button"
          onClick={markHistoryRead}
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
          className="text-ink-muted hover:bg-surface-hover hover:text-ink relative inline-flex size-10 items-center justify-center rounded-md transition-colors"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="bg-brand text-brand-fg absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownTrigger>
      <DropdownMenu className="w-80 max-w-[90vw] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <p className="text-sm font-medium text-ink">Notifications</p>
          {history.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="text-ink-faint hover:text-ink flex items-center gap-1 text-xs"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-ink-faint px-3 py-6 text-center text-sm">
              Nothing yet — actions you take will show up here.
            </p>
          ) : (
            history.map((item) => {
              const Icon = VARIANT_ICON[item.variant];
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0"
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      VARIANT_CLASSES[item.variant],
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                    {item.description && (
                      <p className="text-ink-muted mt-0.5 text-xs">{item.description}</p>
                    )}
                    <p className="text-ink-faint mt-0.5 text-[11px]">
                      {relativeTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenu>
    </Dropdown>
  );
}
