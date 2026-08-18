const MAX_PHOTO_BYTES = 1 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

export type PhotoValidation = { ok: true; url: string } | { ok: false; message: string };

/**
 * Validates an uploaded photo (JPEG/PNG, max 1MB per openapi.yaml) and turns
 * it into a renderable URL. Encodes as a base64 `data:` URI (rather than
 * `URL.createObjectURL`) so the persisted `filePath` survives
 * JSON.stringify/localStorage round-trips and reload/cross-tab viewing —
 * object URLs die with the document that created them, which made every
 * live-uploaded photo render as a blank card the moment anyone else (or the
 * same user after a reload) viewed it.
 */
export async function validateAndStorePhoto(file: File | null): Promise<PhotoValidation> {
  if (!file || file.size === 0) {
    return { ok: false, message: "A photo is required." };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: "Photo must be a JPEG or PNG image." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "Photo must be 1 MB or smaller." };
  }
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { ok: true, url: `data:${file.type};base64,${btoa(binary)}` };
}
