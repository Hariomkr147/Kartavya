import { db, persist } from "../db/store";

/**
 * Both AI features degrade gracefully (CLAUDE.md: "AI features fail soft").
 * A description containing "offline" forces the unavailable path for
 * deliberate testing; otherwise there's a small random chance of it, so the
 * fail-soft UI actually gets exercised during normal demo use too.
 */
function aiIsAvailable(triggerText: string): boolean {
  if (triggerText.toLowerCase().includes("offline")) return false;
  return Math.random() > 0.12;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  POTHOLE: ["pothole", "hole", "road damage", "crater"],
  OPEN_MANHOLE: ["manhole", "drain cover", "sewer cover", "open hole"],
  BROKEN_STREETLIGHT: [
    "street light",
    "streetlight",
    "lamp",
    "lamppost",
    "flicker",
    "dark at night",
  ],
  GARBAGE_OVERFLOW: ["garbage", "trash", "waste", "bin", "rubbish"],
  WATER_LEAKAGE: ["water leak", "pipe burst", "leaking pipe", "water wastage", "leak"],
  DRAINAGE_OVERFLOW: ["drain", "drainage", "waterlogging", "storm water"],
  SEWAGE_BLOCKAGE: ["sewage", "sewer", "blockage"],
  DAMAGED_FOOTPATH: ["footpath", "pavement", "sidewalk", "tiles"],
  FALLEN_TREE: ["tree", "branch", "fallen"],
  STRAY_ANIMAL: ["stray", "dog", "cattle", "animal", "bite"],
  ILLEGAL_DUMPING: ["dumping", "debris", "construction waste", "illegal dump"],
  TRAFFIC_SIGNAL_FAULT: ["traffic signal", "traffic light", "signal", "junction light"],
};

export interface CategorySuggestion {
  aiAvailable: boolean;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  confidence: number | null;
  reasoning: string | null;
  alternativeCategories: {
    categoryId: string;
    categoryName: string;
    confidence: number;
  }[];
}

export function suggestCategoryFromDescription(description: string): CategorySuggestion {
  if (!aiIsAvailable(description)) {
    return {
      aiAvailable: false,
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidence: null,
      reasoning: null,
      alternativeCategories: [],
    };
  }

  const lower = description.toLowerCase();
  const scored = db.categories
    .map((category) => {
      const keywords = CATEGORY_KEYWORDS[category.categoryCode] ?? [];
      const hits = keywords.filter((k) => lower.includes(k)).length;
      return { category, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) {
    return {
      aiAvailable: true,
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidence: null,
      reasoning:
        "The description didn't clearly match any known category — please pick manually.",
      alternativeCategories: [],
    };
  }

  const top = scored[0];
  return {
    aiAvailable: true,
    suggestedCategoryId: String(top.category.id),
    suggestedCategoryName: top.category.categoryName,
    confidence: Math.min(0.95, 0.55 + top.hits * 0.15),
    reasoning: `The description mentions wording consistent with "${top.category.categoryName}".`,
    alternativeCategories: scored.slice(1, 3).map((s) => ({
      categoryId: String(s.category.id),
      categoryName: s.category.categoryName,
      confidence: Math.min(0.85, 0.4 + s.hits * 0.15),
    })),
  };
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
