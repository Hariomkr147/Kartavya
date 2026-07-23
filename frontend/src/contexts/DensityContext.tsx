import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "kartavya-density";

interface DensityContextValue {
  density: Density;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

function getInitialDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(STORAGE_KEY) === "compact"
    ? "compact"
    : "comfortable";
}

/** App-wide table-row density preference (comfortable/compact), same persistence pattern as `ThemeProvider`. */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(getInitialDensity);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, density);
  }, [density]);

  const setDensity = useCallback((next: Density) => setDensityState(next), []);
  const toggleDensity = useCallback(() => {
    setDensityState((current) => (current === "comfortable" ? "compact" : "comfortable"));
  }, []);

  const value = useMemo(
    () => ({ density, setDensity, toggleDensity }),
    [density, setDensity, toggleDensity],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error("useDensity must be used within a DensityProvider");
  return ctx;
}
