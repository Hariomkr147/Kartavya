import { describe, expect, it } from "vitest";
import { slaLabel, slaElapsedSeconds } from "./sla";

const HOUR = 3600 * 1000;

describe("slaLabel", () => {
  it("is null before the clock has started", () => {
    expect(slaLabel(null, null, 0, null)).toBeNull();
    expect(slaLabel(24, null, 0, null)).toBeNull();
  });

  it("is ON_TIME under 80% of target", () => {
    const startedAt = new Date(Date.now() - 5 * HOUR).toISOString();
    expect(slaLabel(24, startedAt, 0, null)).toBe("ON_TIME"); // 5/24 ≈ 21%
  });

  it("is DELAYED between 80% and 100%", () => {
    const startedAt = new Date(Date.now() - 21 * HOUR).toISOString();
    expect(slaLabel(24, startedAt, 0, null)).toBe("DELAYED"); // 21/24 = 87.5%
  });

  it("is OVERDUE past 100%", () => {
    const startedAt = new Date(Date.now() - 30 * HOUR).toISOString();
    expect(slaLabel(24, startedAt, 0, null)).toBe("OVERDUE");
  });

  it("excludes paused time from the calculation", () => {
    // Started 30h ago (would be OVERDUE for a 24h target), but 15h of that
    // was spent paused waiting on the citizen — net elapsed is only 15h,
    // i.e. 62.5% of the 24h target, comfortably ON_TIME.
    const startedAt = new Date(Date.now() - 30 * HOUR).toISOString();
    expect(slaLabel(24, startedAt, 15 * 3600, null)).toBe("ON_TIME");
  });

  it("counts an in-progress pause up to now", () => {
    const startedAt = new Date(Date.now() - 10 * HOUR).toISOString();
    const pausedAt = new Date(Date.now() - 2 * HOUR).toISOString(); // paused 2h ago, still paused
    // Elapsed against SLA: 10h wall clock - 2h currently-open pause = 8h effective.
    const elapsed = slaElapsedSeconds(startedAt, 0, pausedAt) / 3600;
    expect(elapsed).toBeCloseTo(8, 1);
  });
});
