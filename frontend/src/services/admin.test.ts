import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportComplaintsCsv } from "./admin";

/**
 * The CSV export endpoint is the one admin route whose query the backend
 * validates with Pydantic `extra="forbid"` while the mock ignores unknown
 * params. The admin complaints page hands it the same filter object it hands
 * the list endpoint — which carries `sort`, and once carried it all the way to
 * a 400 that only ever appeared against a real backend. Assert the wire
 * request, not the call signature: `QueryParams`' index signature means an
 * extra key still type-checks.
 */
describe("exportComplaintsCsv", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response("ID,Complaint Code\n", { headers: { "Content-Type": "text/csv" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestedUrl(): URL {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return new URL(fetchMock.mock.calls[0][0] as string);
  }

  it("sends only the six filters the contract declares", async () => {
    await exportComplaintsCsv({
      zoneId: "2",
      categoryId: "1",
      status: ["SUBMITTED", "UNDER_REVIEW"],
      slaLabel: "OVERDUE",
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-31T00:00:00.000Z",
      // The list endpoint's params, which this endpoint rejects outright.
      ...({ sort: "-createdAt", page: 3, pageSize: 15, q: "pothole" } as object),
    });

    const url = requestedUrl();
    expect([...new Set(url.searchParams.keys())].sort()).toEqual([
      "categoryId",
      "dateFrom",
      "dateTo",
      "slaLabel",
      "status",
      "zoneId",
    ]);
    // Repeated, not comma-joined — the contract's `status` is an array param.
    expect(url.searchParams.getAll("status")).toEqual(["SUBMITTED", "UNDER_REVIEW"]);
  });

  it("omits filters that are not set rather than sending empty values", async () => {
    await exportComplaintsCsv({ zoneId: "2" });

    expect([...requestedUrl().searchParams.keys()]).toEqual(["zoneId"]);
  });
});
