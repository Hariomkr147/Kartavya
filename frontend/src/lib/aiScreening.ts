import type { AiConfidenceNote } from "@/types/api";

export type ScreeningPhase = "pending" | "done" | "unavailable";

/**
 * AiConfidenceNote has no explicit pending/done flag over the wire — the mock
 * (and, per its description, the real background job too) only fills in
 * `confidence`/`note` once screening finishes. `aiAvailable: true` with both
 * still null is the one state that can only mean "not screened yet."
 */
export function screeningPhase(note: AiConfidenceNote | null | undefined): ScreeningPhase {
  if (!note || !note.aiAvailable) return "unavailable";
  if (note.confidence == null && note.note == null) return "pending";
  return "done";
}
