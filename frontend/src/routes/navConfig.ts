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
  Settings,
} from "lucide-react";
import type { NavItem } from "@/components/layout/AppShell";

// Nav items are module constants (they never change per render), so they
// carry translation keys rather than resolved strings — the shell and the
// command palette translate them at render time, which is also what makes
// them follow a language switch.
export const citizenNavItems: NavItem[] = [
  { labelKey: "nav.dashboard", to: "/citizen", icon: LayoutDashboard, end: true },
  { labelKey: "nav.fileComplaint", to: "/citizen/file", icon: FilePlus2 },
  { labelKey: "nav.myComplaints", to: "/citizen/complaints", icon: ClipboardList },
  { labelKey: "nav.feed", to: "/citizen/feed", icon: Rss },
  { labelKey: "nav.myKartavya", to: "/citizen/gamification", icon: Trophy },
];

export const officerNavItems: NavItem[] = [
  { labelKey: "nav.dashboard", to: "/officer", icon: LayoutDashboard, end: true },
  { labelKey: "nav.queue", to: "/officer/queue", icon: ClipboardList },
  { labelKey: "nav.clusters", to: "/officer/clusters", icon: Boxes },
];

export const adminNavItems: NavItem[] = [
  { labelKey: "nav.dashboard", to: "/admin", icon: LayoutDashboard, end: true },
  { labelKey: "nav.complaints", to: "/admin/complaints", icon: ClipboardList },
  { labelKey: "nav.clusters", to: "/admin/clusters", icon: Boxes },
  { labelKey: "nav.disputes", to: "/admin/disputes", icon: Gavel },
  { labelKey: "nav.users", to: "/admin/users", icon: Users },
  { labelKey: "nav.zonesAndSlas", to: "/admin/zones", icon: MapPinned },
  { labelKey: "nav.officers", to: "/admin/officers", icon: UserCog },
  { labelKey: "nav.leaderboard", to: "/admin/leaderboard", icon: Trophy },
  { labelKey: "nav.settings", to: "/admin/settings", icon: Settings },
];
