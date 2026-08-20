import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import { useComplaintUpdates } from "@/hooks/useComplaintUpdates";
import { updateMessage } from "@/lib/complaintUpdates";
import { citizenNavItems } from "@/routes/navConfig";

/**
 * Files any status change the citizen hasn't seen into the notification
 * bell, from anywhere in the citizen app rather than only on the dashboard.
 * `notify` dedupes by key, so pushing the same change on every render (or
 * from both here and the dashboard's own card) is a no-op.
 */
function ComplaintUpdatesWatcher() {
  const { notify } = useToast();
  const { updates } = useComplaintUpdates();

  useEffect(() => {
    for (const update of updates) {
      notify({
        key: update.key,
        title: updateMessage(update),
        description: update.complaintId,
        variant:
          update.actionNeeded != null
            ? "warning"
            : update.to === "CLOSED" || update.to === "RESOLVED"
              ? "success"
              : "default",
        href: update.href,
        createdAt: update.at,
      });
    }
  }, [updates, notify]);

  return null;
}

/** The citizen's `AppShell`, plus the background watcher that keeps the notification bell honest. */
export function CitizenShell() {
  return (
    <>
      <ComplaintUpdatesWatcher />
      <AppShell
        roleLabelKey="roles.citizen"
        accountPath="/citizen/account"
        navItems={citizenNavItems}
      />
    </>
  );
}
