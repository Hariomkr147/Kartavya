import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for the URL the app actually requests.
 *
 * `buildUrl` once returned `pathname + search`, which threw away the origin of
 * an absolute VITE_API_BASE_URL and sent every call to the site's own domain.
 * Deployed behind an SPA rewrite that is not a 404 — the rewrite answers
 * /api/v1/* with index.html and a 200 — so the failure surfaced as an HTML
 * string reaching callers and a `.map is not a function` crash on an unrelated
 * component. Nothing same-origin (dev, mocks, tests) could catch it.
 *
 * BASE_URL is read once at module load, so each case re-imports the module
 * with a different env.
 */
async function loadApiFetch(baseUrl: string | undefined) {
  vi.resetModules();
  if (baseUrl === undefined) vi.stubEnv("VITE_API_BASE_URL", "");
  else vi.stubEnv("VITE_API_BASE_URL", baseUrl);
  return (await import("./http")).apiFetch;
}

function stubFetch() {
  // Params are typed even though they go unused: `tsc -b` runs over the test
  // files too, and an argument-less mock gives `mock.calls` an empty-tuple type
  // that cannot be indexed.
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([{ id: "1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("apiFetch request URL", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps the host when the base URL is absolute (cross-origin deployment)", async () => {
    const fetchSpy = stubFetch();
    const apiFetch = await loadApiFetch("https://api.example.com/api/v1");

    await apiFetch("/zones");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://api.example.com/api/v1/zones");
  });

  it("carries query parameters across to the absolute URL", async () => {
    const fetchSpy = stubFetch();
    const apiFetch = await loadApiFetch("https://api.example.com/api/v1");

    await apiFetch("/complaints/my", { query: { page: 2, pageSize: 20 } });

    const requested = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requested.origin).toBe("https://api.example.com");
    expect(requested.pathname).toBe("/api/v1/complaints/my");
    expect(requested.searchParams.get("page")).toBe("2");
    expect(requested.searchParams.get("pageSize")).toBe("20");
  });

  it("still resolves same-origin for a relative base URL (mock/dev mode)", async () => {
    const fetchSpy = stubFetch();
    const apiFetch = await loadApiFetch("/api/v1");

    await apiFetch("/zones");

    const requested = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requested.origin).toBe(window.location.origin);
    expect(requested.pathname).toBe("/api/v1/zones");
  });
});
