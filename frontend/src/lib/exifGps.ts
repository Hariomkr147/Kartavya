import { gps } from "exifr";

export interface ExifGps {
  lat: number;
  lng: number;
}

/**
 * Best-effort, client-only GPS read from a photo's EXIF data — used to
 * speed up zone selection at filing time. Never blocks or throws: most
 * demo/downloaded photos have no GPS tags at all (screenshots strip EXIF
 * entirely), so `null` is an expected, common result, not an error.
 */
export async function readExifGps(file: File): Promise<ExifGps | null> {
  try {
    const result = await gps(file);
    if (!result || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
      return null;
    }
    return { lat: result.latitude, lng: result.longitude };
  } catch {
    return null;
  }
}
