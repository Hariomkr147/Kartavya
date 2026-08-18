import { describe, it, expect } from "vitest";
import {
  compressPhoto,
  extractExifSegment,
  injectExifSegment,
} from "@/lib/imageCompression";

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

describe("injectExifSegment", () => {
  it("splices the segment in immediately after the 2-byte SOI marker", () => {
    const jpegWithoutExif = buildJpeg([jfifApp0()]);
    const exif = new Uint8Array(exifApp1());

    const result = injectExifSegment(jpegWithoutExif, exif);

    expect(result.length).toBe(jpegWithoutExif.length + exif.length);
    expect(Array.from(result.subarray(0, 2))).toEqual(SOI);
    expect(Array.from(result.subarray(2, 2 + exif.length))).toEqual(Array.from(exif));
    expect(Array.from(result.subarray(2 + exif.length))).toEqual(
      Array.from(jpegWithoutExif.subarray(2)),
    );
  });

  it("round-trips through extractExifSegment: inject then re-extract yields the same bytes", () => {
    const exif = new Uint8Array(exifApp1());
    const spliced = injectExifSegment(buildJpeg([jfifApp0()]), exif);
    const reExtracted = extractExifSegment(spliced);
    expect(Array.from(reExtracted!)).toEqual(Array.from(exif));
  });
});

describe("compressPhoto", () => {
  // jsdom has no createImageBitmap/canvas encoding, which is itself the
  // condition compressPhoto must fail soft under — every case here exercises
  // that fallback, the same path a very old browser would take in production.
  it("returns the original file unchanged when the platform can't compress", async () => {
    const bytes = new Uint8Array(buildJpeg([jfifApp0()]));
    const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });

    const result = await compressPhoto(file);

    expect(result).toBe(file);
  });

  it("returns non-JPEG/PNG files unchanged", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.gif", { type: "image/gif" });
    expect(await compressPhoto(file)).toBe(file);
  });
});
