import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePhotoGpsLocation } from "./usePhotoGpsLocation";
import { readExifGps } from "@/lib/exifGps";

vi.mock("@/lib/exifGps");

const mockReadExifGps = vi.mocked(readExifGps);

function makeFile(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("usePhotoGpsLocation", () => {
  beforeEach(() => {
    mockReadExifGps.mockReset();
  });

  it("starts at none/idle with no photos", () => {
    // `initialProps` keeps the empty array's reference stable across
    // renders — a fresh `[]` literal re-created on every render would keep
    // the effect's `[photos]` dependency "changing" forever (see the note
    // below), which hangs the test instead of merely failing it.
    const { result } = renderHook(({ photos }) => usePhotoGpsLocation(photos), {
      initialProps: { photos: [] as File[] },
    });
    expect(result.current.scanning).toBe(false);
    expect(result.current.resolution).toEqual({ status: "none" });
  });

  it("reports scanning while the read is in flight, then resolves a single geotagged photo", async () => {
    const file = makeFile("a.jpg");
    mockReadExifGps.mockResolvedValue({ lat: 1, lng: 2 });

    // `initialProps` (rather than a plain closure) matters here: the array
    // literal must stay the *same* reference across the re-renders the
    // hook's own `setResolution` triggers, or the effect's `[photos]`
    // dependency never stabilizes and the scan loops forever.
    const { result } = renderHook(({ photos }) => usePhotoGpsLocation(photos), {
      initialProps: { photos: [file] },
    });
    await waitFor(() => expect(result.current.scanning).toBe(true));

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.resolution).toEqual({
      status: "found",
      location: { lat: 1, lng: 2 },
      source: "single",
      candidates: [{ index: 0, gps: { lat: 1, lng: 2 } }],
    });
  });

  it("goes by whichever photo has GPS when the others don't", async () => {
    const withoutGps = makeFile("a.jpg");
    const withGps = makeFile("b.jpg");
    mockReadExifGps.mockImplementation(async (file) =>
      file === withGps ? { lat: 5, lng: 6 } : null,
    );

    const { result } = renderHook(({ photos }) => usePhotoGpsLocation(photos), {
      initialProps: { photos: [withoutGps, withGps] },
    });

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.resolution).toEqual({
      status: "found",
      location: { lat: 5, lng: 6 },
      source: "single",
      candidates: [{ index: 1, gps: { lat: 5, lng: 6 } }],
    });
  });

  it("flags inconsistent GPS across photos instead of picking one", async () => {
    const a = makeFile("a.jpg");
    const b = makeFile("b.jpg");
    mockReadExifGps.mockImplementation(async (file) =>
      file === a ? { lat: 12.9716, lng: 77.5946 } : { lat: 13.5, lng: 77.5946 },
    );

    const { result } = renderHook(({ photos }) => usePhotoGpsLocation(photos), {
      initialProps: { photos: [a, b] },
    });

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.resolution.status).toBe("inconsistent");
  });

  it("does not re-scan on a pure reorder, but does update which index each candidate points at", async () => {
    const a = makeFile("a.jpg");
    const b = makeFile("b.jpg");
    mockReadExifGps.mockImplementation(async (file) =>
      file === a ? { lat: 1, lng: 2 } : null,
    );

    const { result, rerender } = renderHook(({ photos }) => usePhotoGpsLocation(photos), {
      initialProps: { photos: [a, b] },
    });
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(mockReadExifGps).toHaveBeenCalledTimes(2);
    expect(result.current.resolution).toMatchObject({ candidates: [{ index: 0 }] });

    rerender({ photos: [b, a] }); // same Files, swapped positions
    await waitFor(() =>
      expect(result.current.resolution).toMatchObject({ candidates: [{ index: 1 }] }),
    );
    expect(mockReadExifGps).toHaveBeenCalledTimes(2); // no new EXIF reads
  });

  // Regression test for a real crash: an earlier version derived
  // `resolution`/`scanning` fresh on every render (via `useQueries`, no
  // state, no effect) instead of only writing them from inside an effect.
  // That produced a *new* result object on every single render, even across
  // renders where `photos` hadn't changed at all. `FileComplaintPage`
  // compares this hook's `resolution` by reference to decide whether to
  // sync its own location state — the "adjust state during render" pattern
  // used all over this codebase specifically to avoid calling setState
  // inside a plain effect. A fresh object every render means that
  // comparison sees a "change" on every render, syncs again, re-renders,
  // sees another "change", forever — the exact "Too many re-renders" crash
  // a user hit in the running app. Mount alone can't reproduce this (the
  // very first render's `useState(initial)` trivially matches itself); it
  // takes a *subsequent* re-render with the same input to expose it, which
  // is what `rerender()` below stands in for.
  it("returns a referentially-stable resolution across re-renders that don't change photos", async () => {
    const file = makeFile("a.jpg");
    mockReadExifGps.mockResolvedValue({ lat: 1, lng: 2 });
    const stablePhotos = [file];

    const { result, rerender } = renderHook(() => usePhotoGpsLocation(stablePhotos));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    const settledResolution = result.current.resolution;
    rerender();
    rerender();
    rerender();

    expect(result.current.resolution).toBe(settledResolution);
  });
});
