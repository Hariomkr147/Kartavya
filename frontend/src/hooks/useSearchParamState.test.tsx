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
  // The zone map's shape: a list whose default is not empty, so "none of
  // them" and "the default" are different states.
  const [layers, setLayers] = useSearchParamState<string[]>(
    "layers",
    ["a", "b"],
    csvCodec,
  );
  return {
    zone,
    setZone,
    status,
    setStatus,
    page,
    setPage,
    layers,
    setLayers,
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

  it("drops the key for an empty list whose default is empty", () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper("/?status=CLOSED"),
    });
    act(() => result.current.setStatus([]));
    expect(result.current.search).not.toContain("status");
    expect(result.current.status).toEqual([]);
  });

  // Deleting the key means "read back as the default", so a value that is
  // merely empty — not the default — has to stay written. The zone map's
  // layer toggles are the case: unticking the last box used to drop the key
  // and put all of the default layers back on.
  it("keeps an empty list whose default is not empty", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/") });

    act(() => result.current.setLayers([]));

    expect(result.current.search).toBe("?layers=");
    expect(result.current.layers).toEqual([]);
  });

  it("drops the key when a list is set back to its non-empty default", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/?layers=a") });
    act(() => result.current.setLayers(["a", "b"]));
    expect(result.current.search).not.toContain("layers");
    expect(result.current.layers).toEqual(["a", "b"]);
  });

  // Composing across keys was already handled; two writes to the *same* key
  // in one handler both read the last render's value, so the second won.
  it("composes two updater writes to the same key", () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper("/") });

    act(() => {
      result.current.setStatus((prev) => [...prev, "SUBMITTED"]);
      result.current.setStatus((prev) => [...prev, "RESOLVED"]);
    });

    expect(result.current.status).toEqual(["SUBMITTED", "RESOLVED"]);
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
