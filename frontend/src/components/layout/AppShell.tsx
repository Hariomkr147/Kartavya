import { useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  User as UserIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsPopover } from "@/components/ui/SettingsPopover";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { NotificationCenter } from "@/components/ui/NotificationCenter";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { AnimatedOutlet } from "@/components/layout/AnimatedOutlet";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface AppShellProps {
  roleLabel: string;
  accountPath: string;
  navItems: NavItem[];
}

const SIDEBAR_COLLAPSED_KEY = "kartavya-sidebar-collapsed";
const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;
const SIDEBAR_WIDTH_TRANSITION = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const };

// Labels vanish immediately when collapsing (so they don't overflow the
// shrinking rail) but only fade in once the rail has mostly finished
// expanding (so they don't render into a still-narrow rail and spill into
// the main content).
const LABEL_ENTER_TRANSITION = { delay: 0.16, duration: 0.1 };
const LABEL_EXIT_TRANSITION = { duration: 0.08 };

function FadeLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: LABEL_ENTER_TRANSITION }}
      exit={{ opacity: 0, transition: LABEL_EXIT_TRANSITION }}
      className={cn("whitespace-nowrap", className)}
    >
      {children}
    </motion.span>
  );
}

function displayLabel(name: string, displayName?: string | null): string {
  return displayName?.trim() || name;
}

function readStoredCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

interface BreadcrumbSegment {
  label: string;
  to?: string;
  mono?: boolean;
}

// Nav items only cover top-level section paths (e.g. /citizen/complaints), so
// a detail route (/citizen/complaints/:complaintId) matches its section by
// prefix and gets a synthetic trailing crumb built from the raw route param.
// Detail pages themselves resolve the id to a friendly heading (category
// name) once their data loads, but that would couple this layout to
// per-page fetches — showing the id in mono, the same way every detail
// page's own subtitle does, keeps this section-agnostic and contract-safe.
function buildBreadcrumb(
  pathname: string,
  navItems: NavItem[],
  params: Record<string, string | undefined>,
): BreadcrumbSegment[] {
  const section = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)));

  if (!section) return [];

  const paramId = Object.values(params).find((value): value is string => Boolean(value));
  if (paramId && pathname !== section.to) {
    return [
      { label: section.label, to: section.to },
      { label: paramId, mono: true },
    ];
  }

  return [{ label: section.label }];
}

export function AppShell({ roleLabel, accountPath, navItems }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);

  const breadcrumb = useMemo(
    () => buildBreadcrumb(location.pathname, navItems, params),
    [location.pathname, navItems, params],
  );

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  function handleLogout() {
    // Don't also navigate("/") here — RequireRole reacts to the auth-status
    // change and redirects to /login itself. Calling both races the two
    // navigations and whichever fires second wins, which was landing on the
    // wrong page.
    logout();
  }

  const label = user ? displayLabel(user.name, user.displayName) : "";
  const initial = label.charAt(0).toUpperCase() || "?";

  function renderNav(opts: { collapsedRail: boolean }) {
    return (
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <Tooltip
            key={item.to}
            content={item.label}
            side="right"
            className="w-full"
            disabled={!opts.collapsedRail}
          >
            <NavLink
              to={item.to}
              end={item.end}
              onClick={() => setMobileNavOpen(false)}
              aria-label={opts.collapsedRail ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
                  // Collapsed: centre the icon on the rail's axis instead of
                  // padding it in from the left, so the brand mark, every nav
                  // icon, and the collapse toggle all sit on one vertical line.
                  opts.collapsedRail ? "justify-center px-0" : "px-3",
                  isActive
                    ? "bg-brand/10 text-brand"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                )
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              <AnimatePresence initial={false}>
                {!opts.collapsedRail && <FadeLabel key="label">{item.label}</FadeLabel>}
              </AnimatePresence>
            </NavLink>
          </Tooltip>
        ))}
      </nav>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <motion.aside
        animate={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
        transition={SIDEBAR_WIDTH_TRANSITION}
        className="hidden shrink-0 flex-col overflow-hidden border-r border-line bg-surface md:flex"
      >
        <Brand iconOnly={collapsed} />
        {renderNav({ collapsedRail: collapsed })}
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "text-ink-faint hover:bg-surface-hover hover:text-ink flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
              collapsed ? "justify-center px-0" : "px-3",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-5 shrink-0" aria-hidden="true" />
            )}
            <AnimatePresence initial={false}>
              {!collapsed && <FadeLabel key="label">Collapse</FadeLabel>}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="animate-in fade-in absolute inset-0 bg-black/50 duration-200"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="animate-in slide-in-from-left relative flex h-full w-64 flex-col bg-surface duration-200">
            <div className="flex items-center justify-between px-4 pt-4">
              <Brand bordered={false} />
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="text-ink-muted hover:text-ink -m-1 rounded-md p-1"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            {renderNav({ collapsedRail: false })}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="text-ink-muted hover:bg-surface-hover -ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md md:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>

            <span className="text-ink-faint hidden shrink-0 text-sm font-medium tracking-wide uppercase sm:inline">
              {roleLabel}
            </span>

            {breadcrumb.length > 0 && (
              <>
                <span className="text-ink-faint hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <nav aria-label="Breadcrumb" className="min-w-0">
                  <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                    {breadcrumb.map((segment, index) => (
                      <li key={index} className="flex min-w-0 items-center gap-1.5">
                        {index > 0 && (
                          <ChevronRight
                            className="text-ink-faint size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        {segment.to ? (
                          <NavLink
                            to={segment.to}
                            className="text-ink-muted hover:text-ink truncate font-medium transition-colors"
                          >
                            {segment.label}
                          </NavLink>
                        ) : (
                          <span
                            className={cn(
                              "block max-w-40 truncate font-medium sm:max-w-64",
                              index === breadcrumb.length - 1
                                ? "text-ink"
                                : "text-ink-muted",
                              segment.mono && "font-mono text-xs",
                            )}
                            aria-current={
                              index === breadcrumb.length - 1 ? "page" : undefined
                            }
                          >
                            {segment.label}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CommandPalette navItems={navItems} accountPath={accountPath} />
            <NotificationCenter />
            {/* Replaces the standalone theme toggle that used to sit here:
                the popover shows all three themes (plus density and the
                account link) instead of blind-cycling one step at a time. */}
            <SettingsPopover accountPath={accountPath} />
            <Dropdown align="end">
              <DropdownTrigger>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md py-1 pr-1 pl-2 hover:bg-surface-hover"
                  aria-label="Account menu"
                >
                  <span className="hidden text-sm font-medium text-ink sm:inline">
                    {label}
                  </span>
                  <span className="bg-brand text-brand-fg flex size-8 items-center justify-center rounded-full text-sm font-semibold">
                    {initial}
                  </span>
                </button>
              </DropdownTrigger>
              <DropdownMenu>
                <div className="border-b border-line px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink">{label}</p>
                  <p className="text-ink-faint text-xs">{roleLabel}</p>
                </div>
                <DropdownItem onSelect={() => navigate(accountPath)}>
                  <UserIcon className="size-4" /> Account
                </DropdownItem>
                <DropdownItem destructive onSelect={handleLogout}>
                  <LogOut className="size-4" /> Log out
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </header>

        <OfflineBanner />

        {/*
          The padding lives on an inner wrapper, not on the scroll container.
          A flex column that scrolls its own overflow does not include its
          `padding-bottom` in the scrollable extent, so the last element sat
          flush against the bottom edge of the window once you scrolled all the
          way down — the padding was there, but only above the fold. As part of
          the content it scrolls like everything else.

          `min-h-full` keeps a short page filling the viewport, which is what
          the old `flex-1` on <main> was doing.
        */}
        <main className="flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col p-4 md:p-6">
            <AnimatedOutlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Brand({
  iconOnly = false,
  bordered = true,
}: {
  /** Desktop collapsed rail: icon only, centered. */
  iconOnly?: boolean;
  /** False for the mobile drawer, which supplies its own spacing/close button row instead. */
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-16 shrink-0 items-center gap-2",
        // The collapsed rail is 72px and the nav below pads 12px + 12px, so a
        // flat px-4 here left the shield 8px to the left of every nav icon.
        // Centring both puts them on the same axis at any rail width.
        iconOnly ? "justify-center px-0" : "px-4",
        bordered && "border-b border-line",
      )}
    >
      <ShieldCheck className="text-brand size-6 shrink-0" aria-hidden="true" />
      <AnimatePresence initial={false}>
        {!iconOnly && (
          <FadeLabel key="label" className="font-display text-lg font-semibold text-ink">
            Kartavya
          </FadeLabel>
        )}
      </AnimatePresence>
    </div>
  );
}
