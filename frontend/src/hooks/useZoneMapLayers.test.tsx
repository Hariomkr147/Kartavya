import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useZoneMapLayers } from "./useZoneMapLayers";
import { DEFAULT_LAYERS, LAYER_KEYS } from "@/lib/zoneMapLayers";

const STORAGE_KEY = "kartavya-zoneMap-layers";

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

function useLayers() {
  return { ...useZoneMapLayers(), search: useLocation().search };
}

describe("useZoneMapLayers", () => {
  // Persistence is read once at mount and shared across both maps under one
  // key — a leftover value from an earlier test (or an earlier map) would
  // otherwise make "no param" tests order-dependent.
  beforeEach(() => {
    localStorage.clear();
  });

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

  it("remembers a toggle for the next visit with no ?layers= in the URL", () => {
    const first = renderHook(() => useLayers(), { wrapper: wrapper("/officer/map") });
    act(() => first.result.current.toggle("clusters"));
    act(() => first.result.current.toggle("clusterMembers"));
    first.unmount();

    const second = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    expect(second.result.current.layers.clusters).toBe(false);
    expect(second.result.current.layers.clusterMembers).toBe(true);
    // Remembered state is what a bare URL now falls back to, not a value
    // written into it — a fresh visit with no link stays a clean URL.
    expect(second.result.current.search).toBe("");
  });

  it("a shared link's layers win for that visit, and become the new memory", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["clusters"]));

    const linked = renderHook(() => useLayers(), {
      wrapper: wrapper("/admin/map?layers=zoneRegions,zoneLabels"),
    });
    expect(linked.result.current.layers.zoneRegions).toBe(true);
    expect(linked.result.current.layers.clusters).toBe(false);
    linked.unmount();

    const next = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    expect(next.result.current.layers.zoneRegions).toBe(true);
    expect(next.result.current.layers.clusters).toBe(false);
  });

  it("falls back to the shipped defaults when nothing has ever been remembered", () => {
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    for (const key of LAYER_KEYS) {
      expect(result.current.layers[key]).toBe(DEFAULT_LAYERS.includes(key));
    }
  });

  it("ignores a corrupted or unparseable stored value", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    for (const key of LAYER_KEYS) {
      expect(result.current.layers[key]).toBe(DEFAULT_LAYERS.includes(key));
    }
  });

  it("drops layer names that no longer exist", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["clusters", "aLayerThatUsedToExist"]),
    );
    const { result } = renderHook(() => useLayers(), { wrapper: wrapper("/admin/map") });
    expect(result.current.layers.clusters).toBe(true);
    expect(result.current.layers.zoneRegions).toBe(false);
  });
});
