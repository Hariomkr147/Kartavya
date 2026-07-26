import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Marks the empty-value option (if present in `options`) as informational, not a real selectable choice — for required fields whose only blank row is a "Choose…" placeholder. */
  placeholderDisabled?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  id?: string;
  name?: string;
  onBlur?: () => void;
}

/** Bespoke single-select listbox — for options that need icons, unlike the plain native `<select>` wrapper. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  placeholderDisabled = false,
  error,
  hint,
  className,
  id,
  name,
  onBlur,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const selectable = options.filter((o) => !(placeholderDisabled && o.value === ""));
  const selected = options.find((o) => o.value === value && o.value !== "");
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;

    function handlePointerDown(e: PointerEvent) {
      if (
        listRef.current?.contains(e.target as Node) ||
        trigger?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, selectable.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const option = selectable[activeIndex];
        if (option) {
          onChange(option.value);
          setOpen(false);
          trigger?.focus();
        }
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, selectable, activeIndex, onChange]);

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setActiveIndex(
      Math.max(
        0,
        selectable.findIndex((o) => o.value === value),
      ),
    );
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setOpen(true);
  }

  return (
    <div>
      <div className={cn("relative", className)}>
        <button
          ref={triggerRef}
          id={id}
          name={name}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onClick={toggleOpen}
          onBlur={onBlur}
          className={cn(
            "flex h-11 w-full items-center gap-2 rounded-md border bg-surface px-3 text-left text-sm transition-colors",
            "border-line focus-visible:border-brand focus-visible:outline-none",
            error && "border-status-rejected focus-visible:border-status-rejected",
            selected ? "text-ink" : "text-ink-faint",
          )}
        >
          {selected?.icon}
          <span className="flex-1 truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        </button>

        {open &&
          createPortal(
            <div
              ref={listRef}
              role="listbox"
              style={{
                position: "absolute",
                top: position.top,
                left: position.left,
                width: position.width,
              }}
              className="animate-in fade-in zoom-in-95 z-50 max-h-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-md duration-100"
            >
              {options.map((option) => {
                const disabled = placeholderDisabled && option.value === "";
                const activeI = selectable.findIndex((o) => o.value === option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    disabled={disabled}
                    aria-selected={option.value === value}
                    onMouseEnter={() => {
                      if (!disabled) setActiveIndex(activeI);
                    }}
                    onClick={() => {
                      if (disabled) return;
                      onChange(option.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      disabled
                        ? "cursor-not-allowed text-ink-faint"
                        : cn(
                            "text-ink",
                            activeI === activeIndex
                              ? "bg-surface-hover"
                              : "hover:bg-surface-hover",
                          ),
                    )}
                  >
                    {option.icon}
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.value === value && !disabled && (
                      <Check className="size-4 shrink-0 text-brand" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-status-rejected mt-1.5 text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-ink-faint mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
