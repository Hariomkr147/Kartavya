import "@testing-library/jest-dom/vitest";

// MSW resolves relative-path handler patterns (e.g. "/api/v1/...") against a
// `location` global at handler-creation time. Plain Node (used by
// `// @vitest-environment node` API-integration test files, since MSW's node
// interceptors patch Node's real fetch more reliably than jsdom's own fetch
// polyfill) has no such global, so relative patterns would silently match
// nothing. Real browsers (and jsdom) always have one, so this is a no-op there.
if (typeof globalThis.location === "undefined") {
  Object.defineProperty(globalThis, "location", {
    value: new URL("http://localhost/"),
    writable: true,
  });
}
