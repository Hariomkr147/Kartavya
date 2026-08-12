import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAllUsers } from "@/services/admin";
import { useAuth } from "@/contexts/AuthContext";
import type { User } from "@/types/api";

/**
 * Resolves an `assignedOfficerId` to the officer behind it — **admin only**.
 *
 * No complaint payload carries an officer's name, at any role: the compact
 * `Complaint` shape has `assignedOfficerId` and nothing else, deliberately,
 * because officers are identified to citizens by ID and never by name. That
 * rule is about citizens, though. An admin has full cross-zone visibility of
 * accounts (`GET /admin/users`), so leaving them staring at "Officer #7" on
 * a complaint they are adjudicating is a gap in the UI, not a privacy rule
 * being enforced.
 *
 * So this joins client-side against the user list the admin can already read,
 * rather than widening any complaint response. It is a no-op — `label()` falls
 * back to "Officer #<id>" — for every other role, which is what keeps it safe
 * to thread through shared components: a citizen page can pass the result of
 * this hook and still render exactly what it renders today.
 */
export interface OfficerDirectory {
  /** The officer's account, or undefined for non-admins / unknown ids. */
  get: (officerId: string | null | undefined) => User | undefined;
  /** Display label: full name for an admin, "Officer #7" otherwise. */
  label: (officerId: string | null | undefined) => string;
  /** Name plus email, for the places with room for both. */
  describe: (officerId: string | null | undefined) => string;
}

export function officerFallbackLabel(officerId: string | null | undefined): string {
  return officerId == null ? "Unassigned" : `Officer #${officerId}`;
}

export function useOfficerDirectory(): OfficerDirectory {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const { data } = useQuery({
    queryKey: ["admin", "users", "officer-directory"],
    queryFn: () => getAllUsers({ role: "OFFICER", pageSize: 100 }),
    enabled: isAdmin,
    // Officer accounts change on the order of weeks, and this is a lookup
    // table joined into pages that refetch for their own reasons.
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const byId = new Map<string, User>();
    for (const officer of data?.data ?? []) byId.set(String(officer.id), officer);

    function get(officerId: string | null | undefined) {
      return officerId == null ? undefined : byId.get(String(officerId));
    }

    function label(officerId: string | null | undefined) {
      const officer = get(officerId);
      return officer?.name?.trim() || officerFallbackLabel(officerId);
    }

    function describe(officerId: string | null | undefined) {
      const officer = get(officerId);
      if (!officer) return officerFallbackLabel(officerId);
      const name = officer.name?.trim() || officerFallbackLabel(officerId);
      return officer.email ? `${name} · ${officer.email}` : name;
    }

    return { get, label, describe };
  }, [data]);
}
