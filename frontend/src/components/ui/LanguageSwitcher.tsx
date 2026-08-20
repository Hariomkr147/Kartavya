import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dropdown,
  DropdownMenu,
  DropdownTrigger,
  useDropdownClose,
} from "@/components/ui/Dropdown";
import { useLanguage } from "@/i18n/useLanguage";
import { languageMeta, type Language } from "@/i18n/languages";
import { cn } from "@/lib/utils";

/**
 * The list of languages, as a radio group. Each row leads with the endonym
 * (a citizen looking for Bengali is scanning for "বাংলা", not "Bengali") and
 * keeps the English name beside it so the picker stays navigable to someone
 * who has landed in a script they can't read — the one screen where being
 * stuck in the wrong language has to be recoverable.
 */
export function LanguageOptions({ onPick }: { onPick?: () => void }) {
  const { language, setLanguage, languages } = useLanguage();
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t("settingsPopover.language")} className="grid gap-0.5">
      {languages.map((option) => {
        const active = option.code === language;
        return (
          <button
            key={option.code}
            type="button"
            role="radio"
            aria-checked={active}
            lang={option.code}
            onClick={() => {
              setLanguage(option.code as Language);
              onPick?.();
            }}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
              active
                ? "bg-brand/10 text-brand font-medium"
                : "text-ink hover:bg-surface-hover",
            )}
          >
            <span className="flex-1 truncate">
              {option.nativeName}
              {option.nativeName !== option.englishName && (
                <span className="text-ink-faint ml-1.5 text-xs">
                  {option.englishName}
                </span>
              )}
            </span>
            {active && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function LanguageMenu() {
  const close = useDropdownClose();
  return (
    <div className="p-1">
      <LanguageOptions onPick={close} />
    </div>
  );
}

/**
 * Standalone picker for the pages that render outside `AppShell` (landing,
 * login, register) — someone who cannot read English needs the switch
 * *before* they sign in, not only once they're inside the app.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { language } = useLanguage();

  return (
    <Dropdown align="end">
      <DropdownTrigger>
        <button
          type="button"
          aria-label={t("settingsPopover.language")}
          title={t("settingsPopover.language")}
          className={cn(
            "text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
            className,
          )}
        >
          <Languages className="size-4 shrink-0" aria-hidden="true" />
          <span>{languageMeta(language).nativeName}</span>
        </button>
      </DropdownTrigger>
      <DropdownMenu role="dialog" label={t("settingsPopover.language")} className="w-56 p-0">
        <LanguageMenu />
      </DropdownMenu>
    </Dropdown>
  );
}
