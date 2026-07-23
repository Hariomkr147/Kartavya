const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

export type PhotoValidation = { ok: true; url: string } | { ok: false; message: string };

/**
 * Validates an uploaded photo (JPEG/PNG, max 5MB per openapi.yaml) and turns
 * it into a renderable URL. Uses `URL.createObjectURL` so the real uploaded
 * image actually displays in the UI during the session — object URLs don't
 * survive a hard page reload, which is an accepted limitation of a
 * client-only mock layer (everything else persists via localStorage).
 */
export function validateAndStorePhoto(file: File | null): PhotoValidation {
  if (!file || file.size === 0) {
    return { ok: false, message: "A photo is required." };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: "Photo must be a JPEG or PNG image." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "Photo must be 5 MB or smaller." };
  }
  return { ok: true, url: URL.createObjectURL(file) };
}
