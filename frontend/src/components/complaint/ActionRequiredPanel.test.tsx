import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionRequiredPanel } from "./ActionRequiredPanel";
import { LifecycleTracker } from "./LifecycleTracker";
import type { ComplaintDetail, ComplaintStatus } from "@/types/api";

function complaint(
  status: ComplaintStatus,
  fields: Partial<ComplaintDetail> = {},
): ComplaintDetail {
  return {
    id: "cmp_5001",
    status,
    category: { id: "cat_pothole", code: "POTHOLE", name: "Pothole", slaTargetHours: 72 },
    createdAt: "2026-07-01T10:00:00.000Z",
    ...fields,
  } as ComplaintDetail;
}

const noopHandlers = {
  resubmitPhoto: null,
  onResubmitPhotoChange: vi.fn(),
  onResubmit: vi.fn(),
  resubmitting: false,
  onConfirm: vi.fn(),
  confirming: false,
  onOpenDispute: vi.fn(),
};

describe("ActionRequiredPanel", () => {
  it("shows the officer's own words when more evidence is needed", () => {
    render(
      <ActionRequiredPanel
        complaint={complaint("NEEDS_MORE_EVIDENCE", {
          evidence: [
            {
              id: "ev_1",
              photoUrl: "/p/1",
              sequence: 1,
              verdict: "NEEDS_MORE_EVIDENCE",
              verdictReason: "The photo is too dark to see the road surface.",
              submittedAt: "2026-07-02T10:00:00.000Z",
            },
          ],
        })}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("A clearer photo is needed")).toBeInTheDocument();
    expect(
      screen.getByText("The photo is too dark to see the road surface."),
    ).toBeInTheDocument();
  });

  it("prefers the newest evidence round's reason over an older one", () => {
    render(
      <ActionRequiredPanel
        complaint={complaint("NEEDS_MORE_EVIDENCE", {
          evidence: [
            {
              id: "ev_1",
              photoUrl: "/p/1",
              sequence: 1,
              verdict: "NEEDS_MORE_EVIDENCE",
              verdictReason: "Too dark.",
              submittedAt: "2026-07-02T10:00:00.000Z",
            },
            {
              id: "ev_2",
              photoUrl: "/p/2",
              sequence: 2,
              verdict: "NEEDS_MORE_EVIDENCE",
              verdictReason: "Still can't see the kerb.",
              submittedAt: "2026-07-03T10:00:00.000Z",
            },
          ],
        })}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Still can't see the kerb.")).toBeInTheDocument();
    expect(screen.queryByText("Too dark.")).not.toBeInTheDocument();
  });

  it("explains a rejection instead of leaving the page silent", () => {
    render(
      <ActionRequiredPanel
        complaint={complaint("REJECTED", {
          statusHistory: [
            {
              id: "sh_1",
              toStatus: "REJECTED",
              changedByRole: "OFFICER",
              reason: "This is private property, not a city road.",
              timestamp: "2026-07-04T10:00:00.000Z",
            },
          ],
        })}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("This report was rejected")).toBeInTheDocument();
    expect(
      screen.getByText("This is private property, not a city road."),
    ).toBeInTheDocument();
  });

  it("offers both verdicts on a resolved complaint", () => {
    render(<ActionRequiredPanel complaint={complaint("RESOLVED")} {...noopHandlers} />);

    expect(screen.getByRole("button", { name: /confirm the fix/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /not actually fixed/i }),
    ).toBeInTheDocument();
  });

  it("says so plainly when the city owns the next move", () => {
    render(
      <ActionRequiredPanel
        complaint={complaint("IN_PROGRESS", { assignedOfficerId: "user_2002" })}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Nothing needed from you right now")).toBeInTheDocument();
    expect(screen.getByText(/Officer #user_2002 has this one/)).toBeInTheDocument();
  });
});

describe("LifecycleTracker", () => {
  it("names every stage and marks the current one for assistive tech", () => {
    render(<LifecycleTracker status="IN_PROGRESS" />);

    for (const label of ["Filed", "Evidence check", "Accepted", "Being fixed", "Closed"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Currently at stage 4 of 6: Being fixed/)).toBeInTheDocument();
  });

  it("flags a detour off the happy path", () => {
    render(<LifecycleTracker status="NEEDS_MORE_EVIDENCE" />);
    expect(screen.getByText("Paused — more evidence needed")).toBeInTheDocument();
  });
});
