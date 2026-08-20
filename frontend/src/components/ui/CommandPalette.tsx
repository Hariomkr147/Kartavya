import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  LogOut,
  Moon,
  Rows3,
  Search,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useDensity } from "@/contexts/DensityContext";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/AppShell";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

export interface CommandPaletteProps {
  navItems: NavItem[];
  accountPath: string;
}

/**
 * Cmd/Ctrl+K quick-jump across the current role's own known routes, plus a
 * few account actions — every target is already-known client-side nav
 * config, so opening the palette and picking a result never itself makes a
 * request; navigating there triggers that page's normal existing fetch.
 */
export function CommandPalette({ navItems, accountPath }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { cycleTheme } = useTheme();
  const { toggleDensity } = useDensity();

  const actions: PaletteAction[] = useMemo(
    () => [
      ...navItems.map((item) => ({
        id: `nav:${item.to}`,
        label: t(item.labelKey),
        icon: item.icon,
        run: () => navigate(item.to),
      })),
      {
        id: "action:account",
        label: t("settingsPopover.accountSettings"),
        icon: UserIcon,
        run: () => navigate(accountPath),
      },
      {
        id: "action:theme",
        label: t("palette.cycleTheme"),
        hint: t("palette.cycleThemeHint"),
        icon: Moon,
        run: cycleTheme,
      },
      {
        id: "action:density",
        label: t("palette.toggleDensity"),
        hint: t("palette.toggleDensityHint"),
        icon: Rows3,
        run: toggleDensity,
      },
      {
        id: "action:logout",
        label: t("shell.logOut"),
        icon: LogOut,
        run: logout,
      },
    ],
    [t, navItems, accountPath, navigate, cycleTheme, toggleDensity, logout],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function handleQueryChange(next: string) {
    setQuery(next);
    setActiveIndex(0);
  }

  function openPalette() {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Focus + scroll-lock are DOM side effects tied to `open`, not derived
  // state, so they stay in an effect (nothing here calls setState).
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function runActive() {
    const action = filtered[activeIndex];
    if (!action) return;
    action.run();
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="text-ink-faint hover:border-line-strong hover:text-ink-muted hidden h-9 w-48 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm transition-colors sm:inline-flex"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{t("palette.search")}</span>
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium">
          {navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <button
        type="button"
        onClick={openPalette}
        aria-label={t("palette.open")}
        className="text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex size-10 items-center justify-center rounded-md transition-colors sm:hidden"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh]">
            <div
              className="animate-in fade-in absolute inset-0 bg-black/50 duration-150"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("palette.title")}
              onKeyDown={handleKeyDown}
              className="animate-in fade-in zoom-in-95 relative flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg duration-150"
            >
              <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                <Search className="text-ink-faint size-4 shrink-0" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder={t("palette.placeholder")}
                  aria-label={t("palette.searchCommands")}
                  className="text-ink placeholder:text-ink-faint w-full bg-transparent text-sm focus:outline-none"
                />
                <kbd className="text-ink-faint hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium sm:inline">
                  Esc
                </kbd>
              </div>
              <div className="overflow-y-auto py-1.5">
                {filtered.length === 0 ? (
                  <p className="text-ink-faint px-4 py-6 text-center text-sm">
                    {t("palette.noMatches")}
                  </p>
                ) : (
                  filtered.map((action, i) => (
                    <CommandRow
                      key={action.id}
                      icon={action.icon}
                      active={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={runActive}
                      hint={action.hint}
                    >
                      {action.label}
                    </CommandRow>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function CommandRow({
  icon: Icon,
  active,
  onMouseEnter,
  onClick,
  hint,
  children,
}: {
  icon: LucideIcon;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
        active ? "bg-surface-hover text-ink" : "text-ink-muted",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{children}</span>
      {hint && <span className="text-ink-faint text-xs">{hint}</span>}
    </button>
  );
}
