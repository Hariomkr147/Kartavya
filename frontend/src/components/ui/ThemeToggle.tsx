import { useTranslation } from "react-i18next";
import { Moon, MoonStar, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, amoled: MoonStar };
const LABEL_KEYS: Record<Theme, TranslationKey> = {
  light: "themeToggle.light",
  dark: "themeToggle.dark",
  amoled: "themeToggle.amoled",
};

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, cycleTheme } = useTheme();
  const Icon = ICONS[theme];
  const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "amoled" : "light";

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={t("themeToggle.title", {
        current: t(LABEL_KEYS[theme]),
        next: t(LABEL_KEYS[next]),
      })}
      aria-label={t("themeToggle.ariaLabel", {
        current: t(LABEL_KEYS[theme]),
        next: t(LABEL_KEYS[next]),
      })}
      className={cn(
        "text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex size-10 items-center justify-center rounded-md transition-colors",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
