import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Map as MapIcon } from "lucide-react";

/**
 * The decorative backdrop: a static Voronoi-ish tessellation with a few marks
 * scattered across it.
 *
 * Hand-drawn rather than derived from the real zones, and deliberately so —
 * this is a signpost on the dashboard, not a second map. Rendering live cells
 * here would mean fetching every zone just to draw a thumbnail nobody reads
 * positions off, and a *wrong* small map is worse than an obviously decorative
 * one. Everything is stroked in `currentColor` so the card inherits the brand
 * colour and follows the theme without a `dark:` variant.
 */
function CellPattern() {
  return (
    <svg
      viewBox="0 0 400 96"
      preserveAspectRatio="xMidYMid slice"
      className="text-brand absolute inset-0 size-full opacity-[0.16]"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.25">
        <path d="M0 34 L52 20 L104 46 L96 96" />
        <path d="M104 46 L168 30 L214 62 L150 96" />
        <path d="M214 62 L262 22 L322 44 L300 96" />
        <path d="M322 44 L372 26 L400 58" />
        <path d="M52 20 L58 0" />
        <path d="M168 30 L176 0" />
        <path d="M262 22 L256 0" />
        <path d="M372 26 L380 0" />
        <path d="M96 96 L104 46" />
      </g>
      <g fill="currentColor">
        <circle cx="52" cy="20" r="3" />
        <circle cx="168" cy="30" r="3" />
        <circle cx="262" cy="22" r="3" />
        <circle cx="214" cy="62" r="4.5" />
        <circle cx="322" cy="44" r="3" />
      </g>
    </svg>
  );
}

/**
 * A full-width way into the zone map from a dashboard.
 *
 * Presentational: it takes the route to open, so the same card can sit on any
 * audience's dashboard without knowing whose it is.
 */
export function ZoneMapCallout({ to }: { to: string }) {
  const { t } = useTranslation();

  return (
    <Link
      to={to}
      className="group hover:border-brand/40 relative isolate flex items-center gap-4 overflow-hidden rounded-lg border border-line bg-surface px-5 py-4 transition-colors"
    >
      <span className="from-brand/8 absolute inset-0 -z-10 bg-gradient-to-r to-transparent" />
      <span className="absolute inset-0 -z-10">
        <CellPattern />
      </span>

      <span className="bg-brand/12 text-brand flex size-10 shrink-0 items-center justify-center rounded-lg">
        <MapIcon className="size-5" aria-hidden="true" />
      </span>

      {/* `nav.zoneMap` rather than a string of its own: this card and the nav
          item lead to the same page, so they should read the same, and the
          key is already translated into all eleven locales. */}
      <span className="font-display min-w-0 flex-1 text-base font-semibold text-ink">
        {t("nav.zoneMap")}
      </span>

      <ArrowRight
        className="text-ink-faint group-hover:text-brand size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
