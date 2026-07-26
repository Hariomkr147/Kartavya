import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "warning" | "error";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

export interface ToastHistoryItem extends ToastItem {
  createdAt: string;
}

const HISTORY_LIMIT = 30;

interface ToastContextValue {
  toast: (input: {
    title: string;
    description?: string;
    variant?: ToastVariant;
    durationMs?: number;
  }) => void;
  /** Session log of every toast fired, newest first — toasts themselves auto-dismiss, this doesn't. */
  history: ToastHistoryItem[];
  unreadCount: number;
  markHistoryRead: () => void;
  clearHistory: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<ToastHistoryItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ title, description, variant = "default", durationMs = 5000 }) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, title, description, variant }]);
      setHistory((current) =>
        [
          { id, title, description, variant, createdAt: new Date().toISOString() },
          ...current,
        ].slice(0, HISTORY_LIMIT),
      );
      setUnreadCount((count) => count + 1);
      if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const markHistoryRead = useCallback(() => setUnreadCount(0), []);
  const clearHistory = useCallback(() => {
    setHistory([]);
    setUnreadCount(0);
  }, []);

  const value = useMemo(
    () => ({ toast, history, unreadCount, markHistoryRead, clearHistory }),
    [toast, history, unreadCount, markHistoryRead, clearHistory],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
          role="region"
          aria-label="Notifications"
        >
          {toasts.map((t) => {
            const Icon = VARIANT_ICON[t.variant];
            return (
              <div
                key={t.id}
                role="status"
                className="animate-in slide-in-from-bottom-2 fade-in flex items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg duration-150"
              >
                <Icon
                  className={cn("mt-0.5 size-5 shrink-0", VARIANT_CLASSES[t.variant])}
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink">{t.title}</p>
                  {t.description && (
                    <p className="text-ink-muted mt-0.5 text-sm">{t.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="text-ink-faint hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
