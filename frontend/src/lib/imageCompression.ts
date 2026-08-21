/**
 * Client-side photo compression, run before a photo ever leaves the browser.
 *
 * Phone cameras routinely produce 8-15MB JPEGs. That's slow to upload, and —
 * since the same bytes are what the signed photo route serves back — slow to
 * view later too, for the citizen, the officer, and anyone browsing the
 * public feed. Downscaling and re-encoding client-side fixes both.
 *
 * The actual encoding is delegated to `browser-image-compression`, which
 * replaced a hand-rolled canvas implementation that silently no-opped in
 * production. Three things it does that the hand-rolled version did not:
 * it binary-searches the quality instead of trying three fixed steps, so the
 * result lands near the target rather than just under the ceiling; it runs
 * off the main thread; and it works around Safari's maximum canvas area,
 * above which `toBlob` yields a blank or null result — which the old code
 * caught and turned into "return the original, uncompressed", the most likely
 * reason uncompressed originals were reaching the bucket.
 *
 * Fails soft to the original file for anything unsupported or unexpected: a
 * corrupt image, an encoder that refuses. A slow upload beats a blocked one,
 * and this is a nice-to-have, never a requirement the rest of the flow
 * depends on.
 */

import imageCompression from "browser-image-compression";
// Bundled and served from our own origin, never fetched from a CDN. The
// library's worker calls `importScripts(libURL)`, and `libURL` defaults to a
// jsdelivr URL — a third-party request on every photo upload, which would
// also fail outright offline. `?url` makes Vite emit the dist file as a
// hashed asset and hand us its path.
import compressionLibUrl from "browser-image-compression/dist/browser-image-compression.js?url";

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;
/**
 * What compression aims for, not a ceiling — the encoder can run out of
 * quality steps, or fail and hand back the original, so an uploaded photo may
 * still exceed this. The real limit is the backend's 2MB MAX_UPLOAD_BYTES,
 * which `validate_photo` enforces server-side and FileDropzone mirrors as a
 * backstop. Leave meaningful headroom between the two: a best-effort result
 * that overshoots this target still needs to land under that cap, or the
 * citizen gets their photo rejected instead of merely a larger upload.
 */
const DEFAULT_TARGET_MAX_BYTES = 800 * 1024;
const BYTES_PER_MB = 1024 * 1024;

const APP1_MARKER = 0xffe1;
// "Exif\0\0" — the fixed identifier every EXIF APP1 payload starts with,
// distinguishing it from other APP1 uses (e.g. XMP).
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/**
 * Scans a JPEG's leading segments for its EXIF (APP1) block and returns the
 * raw bytes — marker, length, and payload together — or null if there isn't
 * one. GPS, if the photo carries it, lives inside this block.
 *
 * Compression preserves this block itself (see `preserveExif` below); this
 * function is what lets `hasExifSegment` verify that it actually did, since
 * losing it would silently break GPS-based zone auto-suggestion.
 *
 * Stops at the first non-marker byte or Start-of-Scan (0xFFDA): EXIF, when
 * present, always appears in the handful of segments right after SOI, never
 * after image data begins.
 */
export function extractExifSegment(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // no JPEG SOI
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = (bytes[offset] << 8) | bytes[offset + 1];
    if (marker === 0xffd9 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xffda) break; // Start of Scan — entropy-coded data follows
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === APP1_MARKER) {
      const payloadStart = offset + 4;
      const isExif = EXIF_IDENTIFIER.every((b, i) => bytes[payloadStart + i] === b);
      if (isExif) return bytes.slice(offset, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

async function hasExifSegment(file: File): Promise<boolean> {
  try {
    return extractExifSegment(new Uint8Array(await file.arrayBuffer())) !== null;
  } catch {
    return false;
  }
}

export interface CompressPhotoOptions {
  /** Size to aim for. Defaults to 800KB — see DEFAULT_TARGET_MAX_BYTES; this is a target, not a guarantee. */
  targetMaxBytes?: number;
}

/**
 * Downscales to at most 1920px on the longest side and re-encodes as JPEG at
 * quality 0.8, stepping the quality down further if that alone doesn't reach
 * `targetMaxBytes`. Returns the original file unchanged if it's already at or
 * under the target, if the result comes out no smaller, or if anything about
 * the process fails.
 *
 * `preserveExif` carries the original's EXIF block onto the output, which is
 * what keeps GPS-based zone auto-suggestion working — `usePhotoGpsLocation`
 * reads coordinates from these compressed files, not the originals. The
 * library resets only the orientation tag to 1, correctly, because it has
 * already applied that rotation to the pixels. If the block is lost anyway,
 * we keep the original rather than upload a photo stripped of its location.
 */
export async function compressPhoto(
  file: File,
  options: CompressPhotoOptions = {},
): Promise<File> {
  const targetMaxBytes = options.targetMaxBytes ?? DEFAULT_TARGET_MAX_BYTES;
  if (file.type !== "image/jpeg" && file.type !== "image/png") return file;
  if (file.size <= targetMaxBytes) return file;

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: targetMaxBytes / BYTES_PER_MB,
      maxWidthOrHeight: MAX_DIMENSION,
      initialQuality: JPEG_QUALITY,
      fileType: "image/jpeg",
      useWebWorker: true,
      libURL: new URL(compressionLibUrl, window.location.origin).href,
      preserveExif: true,
    });

    if (compressed.size >= file.size) return file;
    if ((await hasExifSegment(file)) && !(await hasExifSegment(compressed))) {
      return file;
    }

    const compressedName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([compressed], compressedName, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
