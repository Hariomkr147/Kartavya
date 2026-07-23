import { Sparkles, ShieldCheck, Crown, Award, Trophy, Zap, type LucideIcon } from "lucide-react";
import type { Badge } from "@/types/api";

const BADGE_ICONS: Record<Badge["code"], LucideIcon> = {
  KARTAVYA_INITIATE: Sparkles,
  STREET_GUARDIAN: ShieldCheck,
  ZONE_CHAMPION: Crown,
  CENTURY_REFORMER: Award,
  CIVIC_HERO: Trophy,
  SWIFT_REPORTER: Zap,
};

export function iconForBadge(code: Badge["code"]): LucideIcon {
  return BADGE_ICONS[code];
}
