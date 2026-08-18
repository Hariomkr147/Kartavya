/**
 * Client-side photo compression, run before a photo ever leaves the browser.
 *
 * Phone cameras routinely produce 8-15MB JPEGs. That's slow to upload, and —
 * since the same bytes are what the signed photo route serves back — slow to
 * view later too, for the citizen, the officer, and anyone browsing the
 * public feed. Downscaling and re-encoding client-side fixes both.
 *
 * Fails soft to the original file for anything unsupported or unexpected: an
 * old browser without `createImageBitmap`, a corrupt image, a canvas that
 * refuses to encode. A slow upload beats a blocked one, and this is a nice-
 * to-have, never a requirement the rest of the flow depends on.
 */

const MAX_DIMENSION = 1920;
// Tried in order until the result fits `targetMaxBytes` (or steps run out,
// in which case the last, smallest attempt is used as a best effort).
const QUALITY_STEPS = [0.82, 0.6, 0.45];
// Below this, compressing isn't worth the CPU or the quality loss.
const SKIP_COMPRESSION_BELOW_BYTES = 400 * 1024;
const DEFAULT_TARGET_MAX_BYTES = 1 * 1024 * 1024;

const APP1_MARKER = 0xffe1;
// "Exif\0\0" — the fixed identifier every EXIF APP1 payload starts with,
// distinguishing it from other APP1 uses (e.g. XMP).
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

function canCompressInThisEnvironment(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.toBlob === "function"
  );
}

/**
 * Scans a JPEG's leading segments for its EXIF (APP1) block and returns the
 * raw bytes — marker, length, and payload together — or null if there isn't
 * one. GPS, if the photo carries it, lives inside this block; copying it
 * verbatim (never parsing or reinterpreting it) is what lets a resized photo
 * keep its location without this module having to understand EXIF's TIFF
 * structure at all.
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

/** Splices an EXIF (APP1) segment into a JPEG immediately after its SOI marker. */
export function injectExifSegment(
  bytes: Uint8Array,
  exifSegment: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length + exifSegment.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(exifSegment, 2);
  out.set(bytes.subarray(2), 2 + exifSegment.length);
  return out;
}

async function resizeAndEncode(bitmap: ImageBitmap, quality: number): Promise<Blob> {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoding failed"))),
      "image/jpeg",
      quality,
    );
  });
}

export interface CompressPhotoOptions {
  /** Stop trying lower quality steps once a result fits under this. Defaults to 1MB, the backend's MAX_UPLOAD_BYTES. */
  targetMaxBytes?: number;
}

/**
 * Downscales to at most 1920px on the longest side and re-encodes as JPEG,
 * trying progressively lower quality until the result fits `targetMaxBytes`.
 * Returns the original file unchanged if compression doesn't actually help
 * (already small, or the recompressed result isn't smaller), or if anything
 * about the process fails.
 *
 * `imageOrientation: "none"` on the decode is deliberate, not an oversight:
 * `createImageBitmap` can auto-rotate to match EXIF orientation, but this
 * function copies the ORIGINAL EXIF block onto the new pixels afterward —
 * decoding raw (unrotated) keeps the pixel data consistent with the
 * orientation tag that block still carries, instead of applying the rotation
 * twice.
 */
export async function compressPhoto(
  file: File,
  options: CompressPhotoOptions = {},
): Promise<File> {
  const targetMaxBytes = options.targetMaxBytes ?? DEFAULT_TARGET_MAX_BYTES;
  if (!canCompressInThisEnvironment()) return file;
  if (file.type !== "image/jpeg" && file.type !== "image/png") return file;
  if (file.size <= SKIP_COMPRESSION_BELOW_BYTES) return file;

  try {
    const originalBytes = new Uint8Array(await file.arrayBuffer());
    const exifSegment =
      file.type === "image/jpeg" ? extractExifSegment(originalBytes) : null;

    const bitmap = await createImageBitmap(file, { imageOrientation: "none" });
    let best: Blob | null = null;
    try {
      for (const quality of QUALITY_STEPS) {
        const encoded = await resizeAndEncode(bitmap, quality);
        best = encoded;
        if (encoded.size <= targetMaxBytes) break;
      }
    } finally {
      bitmap.close();
    }
    if (!best || best.size >= file.size) return file;

    let finalBytes: Uint8Array<ArrayBuffer> = new Uint8Array(await best.arrayBuffer());
    if (exifSegment) finalBytes = injectExifSegment(finalBytes, exifSegment);

    const compressedName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([finalBytes], compressedName, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
