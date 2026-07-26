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

export const citizenNavItems: NavItem[] = [
  { label: "Dashboard", to: "/citizen", icon: LayoutDashboard, end: true },
  { label: "File a Complaint", to: "/citizen/file", icon: FilePlus2 },
  { label: "My Complaints", to: "/citizen/complaints", icon: ClipboardList },
  { label: "Feed", to: "/citizen/feed", icon: Rss },
  { label: "My Kartavya", to: "/citizen/gamification", icon: Trophy },
];

export const officerNavItems: NavItem[] = [
  { label: "Dashboard", to: "/officer", icon: LayoutDashboard, end: true },
  { label: "Queue", to: "/officer/queue", icon: ClipboardList },
  { label: "Clusters", to: "/officer/clusters", icon: Boxes },
];

export const adminNavItems: NavItem[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard, end: true },
  { label: "Complaints", to: "/admin/complaints", icon: ClipboardList },
  { label: "Clusters", to: "/admin/clusters", icon: Boxes },
  { label: "Disputes", to: "/admin/disputes", icon: Gavel },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Zones & SLAs", to: "/admin/zones", icon: MapPinned },
  { label: "Officers", to: "/admin/officers", icon: UserCog },
  { label: "Leaderboard", to: "/admin/leaderboard", icon: Trophy },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];
