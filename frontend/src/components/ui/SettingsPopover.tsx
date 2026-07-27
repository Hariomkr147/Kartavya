import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Moon,
  MoonStar,
  Rows2,
  Rows3,
  Settings,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  Dropdown,
  DropdownMenu,
  DropdownTrigger,
  useDropdownClose,
} from "@/components/ui/Dropdown";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { useDensity, type Density } from "@/contexts/DensityContext";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "amoled", label: "AMOLED", icon: MoonStar },
];

const DENSITY_OPTIONS: { value: Density; label: string; icon: LucideIcon }[] = [
  { value: "comfortable", label: "Comfortable", icon: Rows2 },
  { value: "compact", label: "Compact", icon: Rows3 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2.5">
      <p className="text-ink-faint mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * A segmented switch, the same `aria-pressed` toggle-button pattern the feed's
 * list/map switch uses. In a panel where every option is visible at once,
 * picking one directly beats the header's old blind "cycle to the next
 * theme" button — you can see which state you're in and jump straight to
 * the one you want.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; icon: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="bg-surface-hover grid gap-1 rounded-md p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-center gap-1 rounded px-2 py-2 text-[11px] font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <option.icon className="size-4" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SettingsPanel({ accountPath }: { accountPath: string }) {
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const closePopover = useDropdownClose();
  const panelRef = useRef<HTMLDivElement>(null);

  // The panel is portaled to the end of <body>, so Tab from the trigger would
  // otherwise skip straight past it to the next header button. Moving focus
  // into the panel on open puts the controls in reach of the keyboard, and
  // Escape (handled by DropdownMenu) returns.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div ref={panelRef} tabIndex={-1} className="focus:outline-none">
      <p className="border-b border-line px-3 py-2 text-sm font-semibold text-ink">
        Settings
      </p>

      <Section title="Theme">
        <Segmented
          label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
        />
      </Section>

      <Section title="Table density">
        <Segmented
          label="Table density"
          options={DENSITY_OPTIONS}
          value={density}
          onChange={setDensity}
        />
      </Section>

      <div className="border-t border-line p-1">
        <Link
          to={accountPath}
          onClick={closePopover}
          className="text-ink hover:bg-surface-hover flex items-center gap-2 rounded px-2 py-2 text-sm transition-colors"
        >
          <UserRound className="text-ink-muted size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Account settings</span>
          <ChevronRight className="text-ink-faint size-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * One home in the header for the app's own preferences. These actions all
 * remain reachable from the command palette (⌘K) too — this is the
 * discoverable path for people who don't know the palette exists.
 */
export function SettingsPopover({ accountPath }: { accountPath: string }) {
  return (
    <Dropdown align="end">
      <DropdownTrigger>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex size-10 items-center justify-center rounded-md transition-colors"
        >
          <Settings className="size-5" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownMenu role="dialog" label="Settings" className="w-64 p-0">
        <SettingsPanel accountPath={accountPath} />
      </DropdownMenu>
    </Dropdown>
  );
}
