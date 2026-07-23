import { Moon, MoonStar, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, amoled: MoonStar };
const LABELS: Record<Theme, string> = {
  light: "Light theme",
  dark: "Dark theme",
  amoled: "AMOLED theme",
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycleTheme } = useTheme();
  const Icon = ICONS[theme];
  const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "amoled" : "light";

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={`${LABELS[theme]} — click to switch to ${LABELS[next]}`}
      aria-label={`${LABELS[theme]}. Click to switch to ${LABELS[next]}.`}
      className={cn(
        "text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex size-10 items-center justify-center rounded-md transition-colors",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
