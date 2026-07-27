import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface DropdownPosition {
  top: number;
  left?: number;
  right?: number;
}

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  align: "start" | "end";
  position: DropdownPosition;
  setPosition: (position: DropdownPosition) => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext(component: string) {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error(`${component} must be used within a <Dropdown>`);
  return ctx;
}

/**
 * Lets custom content inside a `DropdownMenu` dismiss it — `DropdownItem`
 * closes itself, but a panel holding its own links/controls (see
 * `SettingsPopover`) needs to say when it's done.
 */
export function useDropdownClose(): () => void {
  const { setOpen } = useDropdownContext("useDropdownClose");
  return () => setOpen(false);
}

export interface DropdownProps {
  children: ReactNode;
  align?: "start" | "end";
}

/** Bespoke action menu — click/keyboard toggle, outside-click + Escape to close, no floating-ui dependency. */
export function Dropdown({ children, align = "start" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition>({ top: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);

  return (
    <DropdownContext.Provider
      value={{ open, setOpen, triggerRef, align, position, setPosition }}
    >
      {children}
    </DropdownContext.Provider>
  );
}

export function DropdownTrigger({
  children,
}: {
  children: ReactElement<{ onClick?: (e: MouseEvent) => void }>;
}) {
  const { open, setOpen, triggerRef, align, setPosition } =
    useDropdownContext("DropdownTrigger");

  function handleTriggerClick(e: MouseEvent) {
    children.props.onClick?.(e);
    if (open) {
      setOpen(false);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPosition(
      align === "end"
        ? {
            top: rect.bottom + window.scrollY + 4,
            right: window.innerWidth - rect.right - window.scrollX,
          }
        : { top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX },
    );
    setOpen(true);
  }

  return cloneElement(children, {
    onClick: handleTriggerClick,
    ref: triggerRef,
    "aria-expanded": open,
  } as Partial<{
    onClick: (e: MouseEvent) => void;
    ref: typeof triggerRef;
    "aria-expanded": boolean;
  }>);
}

export function DropdownMenu({
  children,
  className,
  role = "menu",
  label,
}: {
  children: ReactNode;
  className?: string;
  /**
   * `menu` for a list of actions (the default). Panels that hold controls
   * rather than commands — switches, radio groups — must pass `dialog`:
   * announcing a settings panel as a menu tells a screen-reader user to
   * expect menu items that aren't there.
   */
  role?: "menu" | "dialog";
  /** Accessible name, required in practice for `role="dialog"`. */
  label?: string;
}) {
  const { open, setOpen, triggerRef, position } = useDropdownContext("DropdownMenu");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;

    function handlePointerDown(e: PointerEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        trigger?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={label}
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        right: position.right,
      }}
      className={cn(
        "animate-in fade-in zoom-in-95 z-50 min-w-[10rem] rounded-md border border-line bg-surface py-1 shadow-md duration-100",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DropdownItem({
  className,
  onSelect,
  destructive,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onSelect?: () => void;
  destructive?: boolean;
}) {
  const { setOpen } = useDropdownContext("DropdownItem");
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        onSelect?.();
        props.onClick?.(e);
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover",
        destructive && "text-status-rejected",
        className,
      )}
      {...props}
    />
  );
}
