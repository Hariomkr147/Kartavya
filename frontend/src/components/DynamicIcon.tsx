import { createElement } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Renders an icon component chosen at runtime (e.g. by category name).
 * `react-hooks/static-components` flags `const Icon = lookup(); <Icon/>` as
 * "creating a component during render" even though the lookup only ever
 * returns stable, pre-existing component references — going through
 * createElement here sidesteps that false positive without changing what
 * actually renders.
 */
export function DynamicIcon({ icon, ...props }: { icon: LucideIcon } & LucideProps) {
  return createElement(icon, props);
}
