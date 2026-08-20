import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import { useOfficerQueueUpdates } from "@/hooks/useOfficerQueueUpdates";
import { officerUpdateMessage } from "@/lib/officerQueueUpdates";
import { officerNavItems } from "@/routes/navConfig";

/**
 * Files any status change on a complaint assigned to this officer into the
 * notification bell, from anywhere in the officer app — most notably a
 * sibling cluster member being resolved out from under them (see
 * `lib/officerQueueUpdates.ts`). `notify` dedupes by key, so pushing the same
 * change on every render is a no-op.
 */
function OfficerQueueUpdatesWatcher() {
  const { notify } = useToast();
  const { updates } = useOfficerQueueUpdates();

  useEffect(() => {
    for (const update of updates) {
      notify({
        key: update.key,
        title: officerUpdateMessage(update),
        variant:
          update.to === "RESOLVED"
            ? "success"
            : update.to === "REJECTED" || update.to === "UNRESOLVABLE"
              ? "warning"
              : "default",
        href: update.href,
        createdAt: update.at,
      });
    }
  }, [updates, notify]);

  return null;
}

/** The officer's `AppShell`, plus the background watcher that keeps the notification bell honest. */
export function OfficerShell() {
  return (
    <>
      <OfficerQueueUpdatesWatcher />
      <AppShell
        roleLabelKey="roles.officer"
        accountPath="/officer/account"
        navItems={officerNavItems}
      />
    </>
  );
}
