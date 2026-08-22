import {
  ClipboardList,
  FilePlus2,
  LayoutDashboard,
  Rss,
  Trophy,
  Users,
  MapPinned,
  Gavel,
  UserCog,
  Boxes,
  Map,
  Settings,
} from "lucide-react";
import type { NavItem } from "@/components/layout/AppShell";

// Nav items are module constants (they never change per render), so they
// carry translation keys rather than resolved strings — the shell and the
// command palette translate them at render time, which is also what makes
// them follow a language switch.
export const citizenNavItems: NavItem[] = [
  {
    labelKey: "nav.dashboard",
    sectionKey: "navSections.overview",
    to: "/citizen",
    icon: LayoutDashboard,
    end: true,
  },
  {
    labelKey: "nav.fileComplaint",
    sectionKey: "navSections.reporting",
    to: "/citizen/file",
    icon: FilePlus2,
  },
  {
    labelKey: "nav.myComplaints",
    sectionKey: "navSections.reporting",
    to: "/citizen/complaints",
    icon: ClipboardList,
  },
  {
    labelKey: "nav.feed",
    sectionKey: "navSections.community",
    to: "/citizen/feed",
    icon: Rss,
  },
  {
    labelKey: "nav.myKartavya",
    sectionKey: "navSections.community",
    to: "/citizen/gamification",
    icon: Trophy,
  },
];

export const officerNavItems: NavItem[] = [
  {
    labelKey: "nav.dashboard",
    sectionKey: "navSections.overview",
    to: "/officer",
    icon: LayoutDashboard,
    end: true,
  },
  {
    labelKey: "nav.queue",
    sectionKey: "navSections.casework",
    to: "/officer/queue",
    icon: ClipboardList,
  },
  {
    labelKey: "nav.clusters",
    sectionKey: "navSections.casework",
    to: "/officer/clusters",
    icon: Boxes,
  },
];

export const adminNavItems: NavItem[] = [
  {
    labelKey: "nav.dashboard",
    sectionKey: "navSections.overview",
    to: "/admin",
    icon: LayoutDashboard,
    end: true,
  },
  {
    labelKey: "nav.leaderboard",
    sectionKey: "navSections.overview",
    to: "/admin/leaderboard",
    icon: Trophy,
  },
  {
    labelKey: "nav.complaints",
    sectionKey: "navSections.operations",
    to: "/admin/complaints",
    icon: ClipboardList,
  },
  {
    labelKey: "nav.disputes",
    sectionKey: "navSections.operations",
    to: "/admin/disputes",
    icon: Gavel,
  },
  {
    labelKey: "nav.clusters",
    sectionKey: "navSections.operations",
    to: "/admin/clusters",
    icon: Boxes,
  },
  {
    labelKey: "nav.zoneMap",
    sectionKey: "navSections.operations",
    to: "/admin/map",
    icon: Map,
  },
  {
    labelKey: "nav.officers",
    sectionKey: "navSections.administration",
    to: "/admin/officers",
    icon: UserCog,
  },
  {
    labelKey: "nav.users",
    sectionKey: "navSections.administration",
    to: "/admin/users",
    icon: Users,
  },
  {
    labelKey: "nav.zonesAndSlas",
    sectionKey: "navSections.administration",
    to: "/admin/zones",
    icon: MapPinned,
  },
  {
    labelKey: "nav.settings",
    sectionKey: "navSections.system",
    to: "/admin/settings",
    icon: Settings,
  },
];
