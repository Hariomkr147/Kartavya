import {
  Construction,
  AlertOctagon,
  Lightbulb,
  Trash2,
  Droplets,
  Waves,
  Droplet,
  Footprints,
  TreeDeciduous,
  PawPrint,
  Trash,
  TrafficCone,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

/** Keyed by the exact Category.name returned by the API — there's no category code exposed over the wire. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Pothole: Construction,
  "Open Manhole": AlertOctagon,
  "Broken Street Light": Lightbulb,
  "Garbage Overflow": Trash2,
  "Water Leakage": Droplets,
  "Drainage Overflow": Waves,
  "Sewage Blockage": Droplet,
  "Damaged Footpath": Footprints,
  "Fallen Tree or Branch": TreeDeciduous,
  "Stray Animal Nuisance": PawPrint,
  "Illegal Dumping": Trash,
  "Traffic Signal Malfunction": TrafficCone,
};

export function iconForCategory(categoryName: string): LucideIcon {
  return CATEGORY_ICONS[categoryName] ?? HelpCircle;
}
