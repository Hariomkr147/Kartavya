import { Link } from "react-router-dom";
import { ArrowUp, CircleAlert, ImageOff } from "lucide-react";
import { StatusPill, SlaPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { Complaint } from "@/types/api";

const ACTION_LABELS: Record<NonNullable<Complaint["citizenActionNeeded"]>, string> = {
  CONFIRM_FIX: "Confirm the fix",
  PROVIDE_MORE_EVIDENCE: "Add more evidence",
};

export function ComplaintListItem({
  complaint,
  to,
}: {
  complaint: Complaint;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3 transition-colors hover:bg-surface-hover"
    >
      <div className="bg-surface-hover flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {complaint.photoUrl ? (
          <img src={complaint.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <ImageOff className="text-ink-faint size-5" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DynamicIcon
            icon={iconForCategory(complaint.category.name)}
            className="text-ink-faint size-4 shrink-0"
            aria-hidden="true"
          />
          <p className="truncate text-sm font-medium text-ink">
            {complaint.category.name}
          </p>
        </div>
        <p className="text-ink-faint mt-0.5 font-mono text-xs">
          {complaint.id} · {relativeTime(complaint.createdAt)}
        </p>
        {complaint.citizenActionNeeded && (
          <p className="text-status-needs_more_evidence mt-1 flex items-center gap-1 text-xs font-medium">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            {ACTION_LABELS[complaint.citizenActionNeeded]}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <StatusPill status={complaint.status} />
        <div className="flex items-center gap-2">
          {complaint.slaLabel && <SlaPill sla={complaint.slaLabel} />}
          {typeof complaint.upvoteCount === "number" && complaint.upvoteCount > 0 && (
            <span className={cn("text-ink-faint flex items-center gap-0.5 text-xs")}>
              <ArrowUp className="size-3.5" aria-hidden="true" />
              {complaint.upvoteCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
