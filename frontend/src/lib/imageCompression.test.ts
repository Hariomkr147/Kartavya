import { describe, it, expect, vi, beforeEach } from "vitest";
import imageCompression from "browser-image-compression";
import { compressPhoto, extractExifSegment } from "@/lib/imageCompression";

// The real library needs a canvas encoder jsdom doesn't have, so the encode
// step is stubbed per-test. What's under test here is everything around it:
// which files get sent to the encoder at all, and what happens to the result.
vi.mock("browser-image-compression", () => ({ default: vi.fn() }));
vi.mock("browser-image-compression/dist/browser-image-compression.js?url", () => ({
  default: "/browser-image-compression.js",
}));

const compressMock = vi.mocked(imageCompression);

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** A fake (not spec-valid, but structurally correct) TIFF-shaped payload — the
 * byte-copying logic under test never parses this, so its contents don't matter. */
const FAKE_TIFF_BYTES = Array.from({ length: 40 }, (_, i) => i);

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2; // length field includes itself
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function exifApp1(): number[] {
  return segment(0xe1, [...EXIF_IDENTIFIER, ...FAKE_TIFF_BYTES]);
}

function jfifApp0(): number[] {
  return segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
}

/** A non-EXIF APP1 (XMP uses the same marker with a different identifier) — must never be mistaken for the EXIF block. */
function xmpApp1(): number[] {
  return segment(0xe1, [
    ...Array.from("http://ns.adobe.com/xap/1.0/\0", (c) => c.charCodeAt(0)),
  ]);
}

function sosAndScanData(): number[] {
  return [...segment(0xda, [0x01, 0x00]), 0x11, 0x22, 0x33, 0x44];
}

function buildJpeg(segments: number[][]): Uint8Array {
  return new Uint8Array([...SOI, ...segments.flat(), ...sosAndScanData(), ...EOI]);
}

describe("extractExifSegment", () => {
  it("returns null for bytes that don't start with a JPEG SOI marker", () => {
    expect(extractExifSegment(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG signature
    expect(extractExifSegment(new Uint8Array([]))).toBeNull();
  });

  it("returns null when the JPEG carries no EXIF block", () => {
    const jpeg = buildJpeg([jfifApp0()]);
    expect(extractExifSegment(jpeg)).toBeNull();
  });

  it("does not mistake a non-EXIF APP1 (e.g. XMP) for the EXIF block", () => {
    const jpeg = buildJpeg([xmpApp1()]);
    expect(extractExifSegment(jpeg)).toBeNull();
  });

  it("extracts the EXIF (APP1) segment verbatim, marker and length included", () => {
    const exif = exifApp1();
    const jpeg = buildJpeg([jfifApp0(), exif]);
    const extracted = extractExifSegment(jpeg);
    expect(extracted).not.toBeNull();
    expect(Array.from(extracted!)).toEqual(exif);
  });

  it("finds EXIF regardless of whether it precedes or follows other APPn segments", () => {
    const exif = exifApp1();
    const before = extractExifSegment(buildJpeg([exif, jfifApp0()]));
    const after = extractExifSegment(buildJpeg([jfifApp0(), exif]));
    expect(Array.from(before!)).toEqual(exif);
    expect(Array.from(after!)).toEqual(exif);
  });

  it("never scans past Start-of-Scan into entropy-coded image data", () => {
    // A byte sequence inside the fake scan data that happens to look like an
    // EXIF marker must not be picked up — SOS ends the segment scan.
    const jpeg = buildJpeg([jfifApp0()]);
    const withTrap = new Uint8Array([
      ...jpeg,
      0xff,
      0xe1,
      0x00,
      0x08,
      ...EXIF_IDENTIFIER,
    ]);
    expect(extractExifSegment(withTrap)).toBeNull();
  });
});

describe("compressPhoto", () => {
  beforeEach(() => {
    compressMock.mockReset();
  });

  /** A JPEG padded out to `size` bytes, EXIF block optional. */
  function jpegOfSize(size: number, { withExif }: { withExif: boolean }): File {
    const header = buildJpeg(withExif ? [jfifApp0(), exifApp1()] : [jfifApp0()]);
    const padded = new Uint8Array(size);
    padded.set(header.subarray(0, Math.min(header.length, size)));
    return new File([padded], "photo.jpg", { type: "image/jpeg" });
  }

  it("returns non-JPEG/PNG files unchanged, without invoking the encoder", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.gif", { type: "image/gif" });
    expect(await compressPhoto(file)).toBe(file);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it("leaves a file already under the target alone", async () => {
    const file = jpegOfSize(50 * 1024, { withExif: false });
    expect(await compressPhoto(file, { targetMaxBytes: 300 * 1024 })).toBe(file);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it("compresses a file over the target and returns the smaller result", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: false });
    compressMock.mockResolvedValue(jpegOfSize(180 * 1024, { withExif: false }));

    const result = await compressPhoto(file, { targetMaxBytes: 300 * 1024 });

    expect(result).not.toBe(file);
    expect(result.size).toBe(180 * 1024);
    expect(result.type).toBe("image/jpeg");
  });

  it("asks the encoder for the requested target, capped at 1920px", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: false });
    compressMock.mockResolvedValue(jpegOfSize(180 * 1024, { withExif: false }));

    await compressPhoto(file, { targetMaxBytes: 300 * 1024 });

    expect(compressMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxSizeMB: (300 * 1024) / (1024 * 1024),
        maxWidthOrHeight: 1920,
        initialQuality: 0.8,
        preserveExif: true,
      }),
    );
  });

  it("never points the worker at a third-party CDN", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: false });
    compressMock.mockResolvedValue(jpegOfSize(180 * 1024, { withExif: false }));

    await compressPhoto(file, { targetMaxBytes: 300 * 1024 });

    const { libURL } = compressMock.mock.calls[0][1];
    expect(new URL(libURL!).origin).toBe(window.location.origin);
  });

  it("falls back to the original when the encoder throws", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: false });
    compressMock.mockRejectedValue(new Error("canvas is too large to encode"));

    expect(await compressPhoto(file, { targetMaxBytes: 300 * 1024 })).toBe(file);
  });

  it("falls back to the original when the result came out no smaller", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: false });
    compressMock.mockResolvedValue(jpegOfSize(5 * 1024 * 1024, { withExif: false }));

    expect(await compressPhoto(file, { targetMaxBytes: 300 * 1024 })).toBe(file);
  });

  // Losing EXIF would silently break GPS-based zone auto-suggestion, which
  // reads coordinates off these compressed files — a smaller photo is not
  // worth a citizen having to drop the pin by hand.
  it("keeps the original rather than upload a photo that lost its EXIF block", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: true });
    compressMock.mockResolvedValue(jpegOfSize(180 * 1024, { withExif: false }));

    expect(await compressPhoto(file, { targetMaxBytes: 300 * 1024 })).toBe(file);
  });

  it("accepts a compressed result that carried the EXIF block through", async () => {
    const file = jpegOfSize(4 * 1024 * 1024, { withExif: true });
    compressMock.mockResolvedValue(jpegOfSize(180 * 1024, { withExif: true }));

    const result = await compressPhoto(file, { targetMaxBytes: 300 * 1024 });

    expect(result).not.toBe(file);
    expect(result.size).toBe(180 * 1024);
  });
});
