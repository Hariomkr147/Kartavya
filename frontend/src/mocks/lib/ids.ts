/**
 * API-facing IDs are just the internal numeric row id, stringified. The
 * OpenAPI schemas only require `type: string` for every id field — the
 * prefixed examples ("cmp_5001", "zone_012", ...) are illustrative, not a
 * pattern the contract enforces — so this stays deliberately simple.
 */
export function toApiId(id: number): string {
  return String(id);
}

export function fromApiId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

/** Human-friendly complaint code, e.g. KTV-2026-000123 (schema.dbml's complaint_code). */
export function generateComplaintCode(sequentialId: number): string {
  const year = new Date().getFullYear();
  return `KTV-${year}-${String(sequentialId).padStart(6, "0")}`;
}
