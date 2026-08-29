import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useZoneMapLayers } from "./useZoneMapLayers";
import { DEFAULT_LAYERS, LAYER_KEYS } from "@/lib/zoneMapLayers";

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

function useLayers() {
  return { ...useZoneMapLayers(), search: useLocation().search };
}

describe("useZoneMapLayers", () => {
  it("starts on the defaults with no param, and leaves the URL clean", () => {
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    for (const key of LAYER_KEYS) {
      expect(result.current.layers[key]).toBe(DEFAULT_LAYERS.includes(key));
    }
    expect(result.current.search).toBe("");
  });

  it("reads the layers named in the URL, and only those", () => {
    const { result } = renderHook(() => useLayers(), {
      wrapper: wrapper("/admin/map?layers=clusters,clusterMembers"),
    });
    expect(result.current.layers.clusters).toBe(true);
    expect(result.current.layers.clusterMembers).toBe(true);
    expect(result.current.layers.zoneRegions).toBe(false);
  });

  it("keeps one layer switched off", () => {
    const { result } = renderHook(() => useLayers(), {
      wrapper: wrapper("/officer/map"),
    });
    act(() => result.current.toggle("clusters"));
    expect(result.current.layers.clusters).toBe(false);
    expect(result.current.search).toContain("layers=");
  });

  // Switching the last layer off serialized to `undefined`, which the setter
  // read as "back to the default" and deleted — so unticking the final box
  // put all five default boxes back on. An empty layer list is a choice, and
  // `?layers=` is how it is held.
  it("keeps every layer switched off", () => {
    const { result } = renderHook(() => useLayers(), {
      wrapper: wrapper("/officer/map"),
    });

    for (const key of LAYER_KEYS) {
      if (result.current.layers[key]) act(() => result.current.toggle(key));
    }

    expect(Object.values(result.current.layers).every((on) => !on)).toBe(true);
    expect(result.current.search).toBe("?layers=");
  });

  it("survives a reload with everything off", () => {
    const { result } = renderHook(() => useLayers(), {
      wrapper: wrapper("/officer/map?layers="),
    });
    expect(Object.values(result.current.layers).every((on) => !on)).toBe(true);
  });

  it("returning to exactly the defaults drops the param again", () => {
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    act(() => result.current.toggle("clusterMembers"));
    expect(result.current.search).toContain("clusterMembers");
    act(() => result.current.toggle("clusterMembers"));
    expect(result.current.search).toBe("");
  });

  // Both toggles used to start from the same render's list, so the second
  // write simply overwrote the first.
  it("lands both toggles when they happen in one handler", () => {
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });

    act(() => {
      result.current.toggle("clusters");
      result.current.toggle("standalone");
    });

    expect(result.current.layers.clusters).toBe(false);
    expect(result.current.layers.standalone).toBe(false);
    expect(result.current.layers.zoneRegions).toBe(true);
  });
});
