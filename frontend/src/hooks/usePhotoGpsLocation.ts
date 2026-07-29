import { useEffect, useRef, useState } from "react";
import { readExifGps, type ExifGps } from "@/lib/exifGps";
import {
  resolveGpsCandidates,
  type PhotoGpsCandidate,
  type PhotoGpsResolution,
} from "@/lib/photoGps";

const NONE: PhotoGpsResolution = { status: "none" };

/**
 * Scans every currently-selected photo for embedded GPS — not just the
 * first — and reconciles the readings via `resolveGpsCandidates`.
 *
 * Results are cached per `File` object, so reordering (which reorders the
 * array but never creates new `File`s) never re-triggers an EXIF read, only
 * adding or removing a photo does.
 *
 * `resolution` and `scanning` are genuine `useState` values, written only
 * from inside the effect below — never derived fresh on every render (that
 * was tried first and produces a *new* result object on every single
 * render, even when `photos` hasn't changed at all; a caller that then
 * compares it by reference — e.g. to decide whether to sync some other
 * state, the standard "adjust state during render" pattern this app uses
 * elsewhere — sees a "change" on every render and loops forever). The ref
 * cache itself is only ever touched from inside the effect, never read
 * during render, so it can't go stale against what's actually being shown.
 */
export function usePhotoGpsLocation(photos: File[]) {
  const cache = useRef<Map<File, ExifGps | null>>(new Map());
  const [resolution, setResolution] = useState<PhotoGpsResolution>(NONE);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const toScan = photos.filter((file) => !cache.current.has(file));
    if (toScan.length > 0) setScanning(true);

    async function run() {
      if (toScan.length > 0) {
        const results = await Promise.all(toScan.map((file) => readExifGps(file)));
        if (cancelled) return;
        toScan.forEach((file, i) => cache.current.set(file, results[i]));
      }
      if (cancelled) return;
      setScanning(false);
      // Recomputed even when nothing new needed scanning — a pure reorder
      // changes each candidate's `index` (which photo the UI should point
      // at) without changing what was actually read from any file.
      const candidates: PhotoGpsCandidate[] = [];
      photos.forEach((file, index) => {
        const gps = cache.current.get(file);
        if (gps) candidates.push({ index, gps });
      });
      setResolution(resolveGpsCandidates(candidates));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  return { resolution, scanning };
}
