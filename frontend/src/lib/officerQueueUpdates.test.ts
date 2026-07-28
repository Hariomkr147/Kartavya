import { describe, expect, it } from "vitest";
import { diffOfficerQueue, officerUpdateMessage, snapshotOf } from "./officerQueueUpdates";
import type { Complaint, ComplaintStatus } from "@/types/api";

function complaint(
  id: string,
  status: ComplaintStatus,
  fields: Partial<Complaint> = {},
): Complaint {
  return {
    id,
    status,
    category: { id: "cat_pothole", code: "POTHOLE", name: "Pothole", slaTargetHours: 72 },
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...fields,
  } as Complaint;
}

describe("diffOfficerQueue", () => {
  it("reports nothing on a first visit, so a whole workload isn't announced as new", () => {
    expect(diffOfficerQueue(null, [complaint("cmp_1", "UNDER_RESOLUTION")])).toEqual([]);
  });

  it("reports a status change against the last snapshot", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const updates = diffOfficerQueue(before, [complaint("cmp_1", "RESOLVED")]);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      complaintId: "cmp_1",
      from: "IN_PROGRESS",
      to: "RESOLVED",
      href: "/officer/queue/cmp_1",
    });
  });

  it("stays quiet when nothing moved", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    expect(diffOfficerQueue(before, [complaint("cmp_1", "IN_PROGRESS")])).toEqual([]);
  });

  it("ignores complaints assigned since the snapshot — the officer just claimed them", () => {
    const before = snapshotOf([complaint("cmp_1", "SUBMITTED")]);
    const updates = diffOfficerQueue(before, [
      complaint("cmp_1", "SUBMITTED"),
      complaint("cmp_2", "EVIDENCE_UNDER_REVIEW"),
    ]);
    expect(updates).toEqual([]);
  });

  it("keys each change by its transition so re-diffing can't announce it twice", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const first = diffOfficerQueue(before, [complaint("cmp_1", "RESOLVED")]);
    const again = diffOfficerQueue(before, [complaint("cmp_1", "RESOLVED")]);
    expect(first[0].key).toBe(again[0].key);
  });

  it("orders newest first", () => {
    const before = snapshotOf([
      complaint("cmp_1", "IN_PROGRESS"),
      complaint("cmp_2", "UNDER_REVIEW"),
    ]);
    const updates = diffOfficerQueue(before, [
      complaint("cmp_1", "RESOLVED", { updatedAt: "2026-07-20T09:00:00.000Z" }),
      complaint("cmp_2", "IN_PROGRESS", { updatedAt: "2026-07-21T09:00:00.000Z" }),
    ]);
    expect(updates.map((u) => u.complaintId)).toEqual(["cmp_2", "cmp_1"]);
  });

  it("reports a sibling swept RESOLVED by a cluster cascade the same as any other move", () => {
    // The whole point of this module: this complaint moved without the
    // officer touching it — the compact row can't say a cascade did it, so
    // the diff reports the move plainly and the timeline explains why later.
    const before = snapshotOf([complaint("cmp_2", "IN_PROGRESS")]);
    const updates = diffOfficerQueue(before, [complaint("cmp_2", "RESOLVED")]);
    expect(updates).toEqual([
      expect.objectContaining({ complaintId: "cmp_2", from: "IN_PROGRESS", to: "RESOLVED" }),
    ]);
  });
});

describe("officerUpdateMessage", () => {
  it("describes the change without claiming to know who or what caused it", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const [update] = diffOfficerQueue(before, [complaint("cmp_1", "RESOLVED")]);
    expect(officerUpdateMessage(update)).toBe(
      "Pothole complaint cmp_1 moved to Resolved.",
    );
  });
});
