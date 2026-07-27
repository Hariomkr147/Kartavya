import { describe, expect, it } from "vitest";
import { diffComplaints, snapshotOf, updateMessage } from "./complaintUpdates";
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

describe("diffComplaints", () => {
  it("reports nothing on a first visit, so a whole history isn't announced as new", () => {
    expect(diffComplaints(null, [complaint("cmp_1", "RESOLVED")])).toEqual([]);
  });

  it("reports a status change against the last snapshot", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const updates = diffComplaints(before, [complaint("cmp_1", "RESOLVED")]);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      complaintId: "cmp_1",
      from: "IN_PROGRESS",
      to: "RESOLVED",
      href: "/citizen/complaints/cmp_1",
    });
  });

  it("stays quiet when nothing moved", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    expect(diffComplaints(before, [complaint("cmp_1", "IN_PROGRESS")])).toEqual([]);
  });

  it("ignores complaints filed since the snapshot — the citizen filed them", () => {
    const before = snapshotOf([complaint("cmp_1", "SUBMITTED")]);
    const updates = diffComplaints(before, [
      complaint("cmp_1", "SUBMITTED"),
      complaint("cmp_2", "SUBMITTED"),
    ]);
    expect(updates).toEqual([]);
  });

  it("keys each change by its transition so re-diffing can't announce it twice", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const first = diffComplaints(before, [complaint("cmp_1", "RESOLVED")]);
    const again = diffComplaints(before, [complaint("cmp_1", "RESOLVED")]);
    expect(first[0].key).toBe(again[0].key);
  });

  it("orders newest first", () => {
    const before = snapshotOf([
      complaint("cmp_1", "IN_PROGRESS"),
      complaint("cmp_2", "IN_PROGRESS"),
    ]);
    const updates = diffComplaints(before, [
      complaint("cmp_1", "RESOLVED", { updatedAt: "2026-07-20T09:00:00.000Z" }),
      complaint("cmp_2", "CLOSED", { updatedAt: "2026-07-21T09:00:00.000Z" }),
    ]);
    expect(updates.map((u) => u.complaintId)).toEqual(["cmp_2", "cmp_1"]);
  });
});

describe("updateMessage", () => {
  it("describes the change in the citizen's own terms", () => {
    const before = snapshotOf([complaint("cmp_1", "IN_PROGRESS")]);
    const [update] = diffComplaints(before, [complaint("cmp_1", "RESOLVED")]);
    expect(updateMessage(update)).toBe(
      "Your pothole report was marked fixed — please confirm it.",
    );
  });
});
