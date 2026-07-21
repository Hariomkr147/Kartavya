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

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  align: "start" | "end";
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext(component: string) {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error(`${component} must be used within a <Dropdown>`);
  return ctx;
}

export interface DropdownProps {
  children: ReactNode;
  align?: "start" | "end";
}

/** Bespoke action menu — click/keyboard toggle, outside-click + Escape to close, no floating-ui dependency. */
export function Dropdown({ children, align = "start" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerRef, align }}>
      {children}
    </DropdownContext.Provider>
  );
}

export function DropdownTrigger({
  children,
}: {
  children: ReactElement<{ onClick?: (e: MouseEvent) => void }>;
}) {
  const { open, setOpen, triggerRef } = useDropdownContext("DropdownTrigger");
  return cloneElement(children, {
    onClick: (e: MouseEvent) => {
      children.props.onClick?.(e);
      setOpen(!open);
    },
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
}: {
  children: ReactNode;
  className?: string;
}) {
  const { open, setOpen, triggerRef, align } = useDropdownContext("DropdownMenu");
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left?: number;
    right?: number;
  }>({ top: 0 });

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      setPosition(
        align === "end"
          ? {
              top: rect.bottom + window.scrollY + 4,
              right: window.innerWidth - rect.right - window.scrollX,
            }
          : { top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX },
      );
    }

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
  }, [open, align, setOpen, triggerRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
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
