/**
 * Types for `open-location-code`, which ships none of its own.
 *
 * Google's reference implementation (Apache-2.0, no dependencies). Only the
 * members `src/lib/plusCode.ts` uses are declared — deliberately, so an
 * unchecked call to an undeclared method fails the build rather than silently
 * becoming `any`.
 *
 * Verified against the installed package at v1.0.3: `OpenLocationCode` is a
 * constructor, not a namespace of statics, and the methods live on the
 * prototype.
 */
declare module "open-location-code" {
  /** The rectangle a code refers to. A code is an area, never a point. */
  export interface CodeArea {
    latitudeLo: number;
    longitudeLo: number;
    latitudeHi: number;
    longitudeHi: number;
    latitudeCenter: number;
    longitudeCenter: number;
    codeLength: number;
  }

  export class OpenLocationCode {
    /** True for any syntactically valid code, short or full. */
    isValid(code: string): boolean;
    /** True for a code missing its leading characters, e.g. "XMV5+8Q". */
    isShort(code: string): boolean;
    /** True for a self-contained code, e.g. "7J4VXMV5+8Q". */
    isFull(code: string): boolean;
    encode(latitude: number, longitude: number, codeLength?: number): string;
    /** Throws on an invalid or short code. */
    decode(code: string): CodeArea;
    /** Expand a short code using a nearby reference point. Throws on bad input. */
    recoverNearest(
      shortCode: string,
      referenceLatitude: number,
      referenceLongitude: number,
    ): string;
    shorten(code: string, latitude: number, longitude: number): string;
  }
}
