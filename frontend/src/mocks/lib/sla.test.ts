import { describe, expect, it } from "vitest";
import { avgResolutionHours, resolutionHours, slaLabel, slaElapsedSeconds } from "./sla";
import type { ComplaintRow } from "../db/types";

const HOUR = 3600 * 1000;

/** Only the fields the resolution-time rules read; the rest is irrelevant here. */
function complaint(fields: Partial<ComplaintRow>): ComplaintRow {
  return {
    createdAt: new Date(Date.now() - 100 * HOUR).toISOString(),
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    resolvedAt: null,
    closedAt: null,
    ...fields,
  } as ComplaintRow;
}

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

describe("resolutionHours", () => {
  it("measures resolvedAt minus slaStartedAt, not minus createdAt", () => {
    // Filed 100h ago, but the officer only became responsible 30h ago.
    const c = complaint({
      slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
      resolvedAt: new Date(Date.now() - 10 * HOUR).toISOString(),
    });
    expect(resolutionHours(c)).toBeCloseTo(20, 5);
  });

  it("excludes time parked in NEEDS_MORE_EVIDENCE", () => {
    const c = complaint({
      slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
      resolvedAt: new Date(Date.now() - 10 * HOUR).toISOString(),
      slaPausedSeconds: 8 * 3600,
    });
    expect(resolutionHours(c)).toBeCloseTo(12, 5);
  });

  it("cannot disagree with slaLabel about the same complaint", () => {
    // 30h of wall clock against a 24h target, but 15h of it paused: slaLabel
    // says ON_TIME, so the resolution time must also come in under target.
    const startedAt = new Date(Date.now() - 30 * HOUR).toISOString();
    const c = complaint({
      slaStartedAt: startedAt,
      resolvedAt: new Date().toISOString(),
      slaPausedSeconds: 15 * 3600,
    });
    expect(slaLabel(24, startedAt, 15 * 3600, null)).toBe("ON_TIME");
    expect(resolutionHours(c)!).toBeLessThan(24);
  });

  it("stops at resolvedAt, ignoring how long the citizen took to confirm", () => {
    const base = {
      slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
      resolvedAt: new Date(Date.now() - 20 * HOUR).toISOString(),
    };
    expect(resolutionHours(complaint({ ...base, closedAt: null }))).toBe(
      resolutionHours(
        complaint({ ...base, closedAt: new Date(Date.now() - HOUR).toISOString() }),
      ),
    );
  });

  it("is null for a complaint that never resolved", () => {
    expect(
      resolutionHours(
        complaint({ slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString() }),
      ),
    ).toBeNull();
  });

  it("is null when the clock never started (rejected at evidence review)", () => {
    expect(
      resolutionHours(complaint({ resolvedAt: new Date().toISOString() })),
    ).toBeNull();
  });
});

describe("avgResolutionHours", () => {
  it("is null — never 0 — for an empty sample", () => {
    expect(avgResolutionHours([])).toBeNull();
  });

  it("skips complaints outside the sample instead of counting them as zero", () => {
    const resolved = complaint({
      slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
      resolvedAt: new Date(Date.now() - 10 * HOUR).toISOString(),
    });
    const stillOpen = complaint({
      slaStartedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
    });
    expect(avgResolutionHours([resolved, stillOpen])).toBeCloseTo(20, 5);
  });

  it("is null when nothing in the sample ever resolved", () => {
    expect(avgResolutionHours([complaint({}), complaint({})])).toBeNull();
  });

  it("averages the sample", () => {
    const make = (hours: number) =>
      complaint({
        slaStartedAt: new Date(Date.now() - hours * HOUR).toISOString(),
        resolvedAt: new Date().toISOString(),
      });
    expect(avgResolutionHours([make(10), make(20), make(30)])).toBeCloseTo(20, 5);
  });
});
