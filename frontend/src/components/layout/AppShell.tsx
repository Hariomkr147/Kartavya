import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
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
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
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

function displayLabel(name: string, displayName?: string | null): string {
  return displayName?.trim() || name;
}

function readStoredCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

export function AppShell({ roleLabel, accountPath, navItems }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);

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
        {navItems.map((item) => {
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileNavOpen(false)}
              aria-label={opts.collapsedRail ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  opts.collapsedRail && "justify-center px-0",
                  isActive
                    ? "bg-brand/10 text-brand"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                )
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              {!opts.collapsedRail && item.label}
            </NavLink>
          );
          return opts.collapsedRail ? (
            <Tooltip key={item.to} content={item.label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <motion.aside
        animate={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="hidden shrink-0 flex-col border-r border-line bg-surface md:flex"
      >
        <Brand iconOnly={collapsed} />
        {renderNav({ collapsedRail: collapsed })}
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "text-ink-faint hover:bg-surface-hover hover:text-ink flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="size-5 shrink-0" aria-hidden="true" />
                Collapse
              </>
            )}
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
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="text-ink-muted hover:bg-surface-hover -ml-1 inline-flex size-9 items-center justify-center rounded-md md:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <span className="text-ink-faint hidden text-sm font-medium tracking-wide uppercase sm:inline">
              {roleLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
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

        <main className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
          <AnimatedOutlet />
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
        "flex h-16 shrink-0 items-center gap-2 px-4",
        bordered && "border-b border-line",
        iconOnly && "justify-center px-0",
      )}
    >
      <ShieldCheck className="text-brand size-6 shrink-0" aria-hidden="true" />
      {!iconOnly && (
        <span className="font-display text-lg font-semibold text-ink">Kartavya</span>
      )}
    </div>
  );
}
