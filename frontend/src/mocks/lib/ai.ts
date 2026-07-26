import { db, persist } from "../db/store";

/**
 * Both AI features degrade gracefully (CLAUDE.md: "AI features fail soft").
 * The trigger text containing "offline" forces the unavailable path for
 * deliberate testing; otherwise there's a small random chance of it, so the
 * fail-soft UI actually gets exercised during normal demo use too.
 */
function aiIsAvailable(triggerText: string): boolean {
  if (triggerText.toLowerCase().includes("offline")) return false;
  return Math.random() > 0.12;
}

/**
 * Fire-and-forget: flips an ai_zone_reports row from PENDING to READY/FAILED
 * a couple of seconds after being triggered, simulating the real backend's
 * async LLM-generated zone health report without blocking the POST call.
 */
export function simulateAiZoneReportGeneration(reportId: number, zoneName: string): void {
  const delayMs = 2000 + Math.random() * 2500;
  setTimeout(() => {
    const report = db.aiZoneReports.find((r) => r.id === reportId);
    if (!report) return;
    const now = new Date().toISOString();
    if (aiIsAvailable(zoneName)) {
      report.status = "READY";
      report.aiAvailable = true;
      report.summary = `${zoneName} is showing a stable overall complaint volume this period, with most reports moving through review within their target window.`;
      report.trends = `Category mix is broadly steady; a small uptick in drainage and water-related reports tracks with recent weather.`;
      report.hotspots = `Complaints cluster loosely around the main market road and the northern residential blocks.`;
      report.suggestions = `Consider a proactive drain-clearing pass ahead of the next expected rainfall, and prioritise re-inspection of the oldest open reports first.`;
    } else {
      report.status = "FAILED";
      report.aiAvailable = false;
      report.summary = null;
      report.trends = null;
      report.hotspots = null;
      report.suggestions = null;
    }
    report.generatedAt = now;
    persist();
  }, delayMs);
}

/**
 * Fire-and-forget: flips an evidence row's ai_screen_status from PENDING to
 * DONE/UNAVAILABLE a couple of seconds after upload, simulating the real
 * backend's async pre-screening job without blocking the create/upload call.
 */
export function simulateEvidenceScreening(
  evidenceId: number,
  categoryName: string,
): void {
  const delayMs = 1500 + Math.random() * 2000;
  setTimeout(() => {
    const evidenceRow = db.evidence.find((e) => e.id === evidenceId);
    if (!evidenceRow) return;
    if (aiIsAvailable(categoryName)) {
      const confidence = 0.6 + Math.random() * 0.35;
      evidenceRow.aiScreenStatus = "DONE";
      evidenceRow.aiConfidence = Math.round(confidence * 100) / 100;
      evidenceRow.aiMatchesCategory = confidence > 0.7;
      evidenceRow.aiNote =
        confidence > 0.7
          ? `Photo appears consistent with a ${categoryName.toLowerCase()} report.`
          : `Photo is ambiguous — may not clearly show a ${categoryName.toLowerCase()} issue.`;
    } else {
      evidenceRow.aiScreenStatus = "UNAVAILABLE";
      evidenceRow.aiConfidence = null;
      evidenceRow.aiMatchesCategory = null;
      evidenceRow.aiNote = null;
    }
    persist();
  }, delayMs);
}
