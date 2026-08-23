import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_MEMBER_CLUSTER_LIMIT, useClusterMembers } from "./useZoneMapData";
import { getClusterById } from "@/services/shared";

vi.mock("@/services/shared", () => ({
  getClusterById: vi.fn(),
  getClusters: vi.fn(),
}));

const fetchOne = vi.mocked(getClusterById);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** More ids than the ceiling, so the slice is exercised too. */
const ids = Array.from({ length: MAP_MEMBER_CLUSTER_LIMIT + 5 }, (_, i) => `c${i}`);

beforeEach(() => {
  fetchOne.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchOne.mockResolvedValue({ id: "c0", complaints: [] } as any);
});

describe("useClusterMembers", () => {
  /**
   * The members layer is off by default, and `enabled` only suppresses
   * *automatic* fetches — `refetch()` reaches `query.fetch()` with no
   * `enabled` check on the path. Without the guard in the hook, one click of
   * the map's RefreshButton on the default view fired one request per visible
   * cluster for pins that are never drawn.
   */
  it("does not fetch on refresh while the layer is off", async () => {
    const { result } = renderHook(() => useClusterMembers(ids, false), {
      wrapper: wrapper(),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchOne).not.toHaveBeenCalled();

    await result.current.refetch();

    expect(fetchOne).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });

  it("fetches up to the ceiling, and refreshes them, once the layer is on", async () => {
    const { result } = renderHook(() => useClusterMembers(ids, true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(fetchOne).toHaveBeenCalledTimes(MAP_MEMBER_CLUSTER_LIMIT));
    // Clusters past the ceiling are reported rather than silently dropped.
    expect(result.current.omittedCount).toBe(ids.length - MAP_MEMBER_CLUSTER_LIMIT);

    await result.current.refetch();

    expect(fetchOne).toHaveBeenCalledTimes(MAP_MEMBER_CLUSTER_LIMIT * 2);
  });
});
