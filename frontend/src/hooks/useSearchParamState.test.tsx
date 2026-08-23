import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { csvCodec, useSearchParamState } from "./useSearchParamState";

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

/** The admin complaints page's shape: several filters plus `page`, all in the URL. */
function useFilters() {
  const [zone, setZone] = useSearchParamState("zone", "");
  const [status, setStatus] = useSearchParamState<string[]>("status", [], csvCodec);
  const [page, setPage] = useSearchParamState("page", 1, {
    serialize: String,
    deserialize: (raw) => Number.parseInt(raw, 10) || 1,
  });
  return {
    zone,
    setZone,
    status,
    setStatus,
    page,
    setPage,
    search: useLocation().search,
  };
}

describe("useSearchParamState", () => {
  it("reads and writes a single key", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/?zone=z-1") });
    expect(result.current.zone).toBe("z-1");

    act(() => result.current.setZone("z-2"));
    expect(result.current.zone).toBe("z-2");
  });

  it("drops the key when set back to the default", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/?zone=z-1") });
    act(() => result.current.setZone(""));
    expect(result.current.search).not.toContain("zone");
  });

  // react-router derives a functional `setSearchParams` update from the params
  // of the last render, so two writes in one handler used to both start from
  // the same snapshot and the second navigation discarded the first. On the
  // admin complaints page every filter is `setX(v); setPage(1)`, which made
  // the page reset win and no filter ever apply.
  it("composes two writes in the same event handler", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/?page=4") });

    act(() => {
      result.current.setZone("z-9");
      result.current.setPage(1);
    });

    expect(result.current.zone).toBe("z-9");
    expect(result.current.page).toBe(1);
    expect(result.current.search).not.toContain("page=4");
  });

  it("composes three writes, including an array codec", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/?page=3") });

    act(() => {
      result.current.setZone("z-1");
      result.current.setStatus(["SUBMITTED", "RESOLVED"]);
      result.current.setPage(1);
    });

    expect(result.current.zone).toBe("z-1");
    expect(result.current.status).toEqual(["SUBMITTED", "RESOLVED"]);
    expect(result.current.page).toBe(1);
  });

  it("does not carry a stale snapshot across separate handlers", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/") });

    act(() => result.current.setZone("z-1"));
    act(() => result.current.setStatus(["CLOSED"]));
    act(() => result.current.setZone(""));

    expect(result.current.zone).toBe("");
    expect(result.current.status).toEqual(["CLOSED"]);
  });
});
