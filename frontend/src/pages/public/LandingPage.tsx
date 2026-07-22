import { Link } from "react-router-dom";
import {
  Camera,
  ClipboardCheck,
  BarChart3,
  ArrowRight,
  EyeOff,
  Sparkles,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { LinkButton } from "@/components/ui/LinkButton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";

const GRID_SIZE = 60;
/** Hand-placed, not random — a deliberate scatter rather than visual noise. */
const ACCENTED_CELLS: Record<number, string> = {
  3: "bg-status-in_progress",
  7: "bg-status-resolved",
  12: "bg-status-under_review",
  15: "bg-status-evidence_under_review",
  22: "bg-status-resolved",
  27: "bg-status-in_progress",
  31: "bg-status-under_review",
  38: "bg-status-resolved",
  41: "bg-status-evidence_under_review",
  46: "bg-status-in_progress",
  52: "bg-status-resolved",
  55: "bg-status-under_review",
};
const PULSING_CELLS = new Set([22, 41]);

function HeroGrid() {
  return (
    <div className="grid grid-cols-10 gap-2.5 sm:gap-3" aria-hidden="true">
      {Array.from({ length: GRID_SIZE }, (_, i) => (
        <span
          key={i}
          className={cn(
            "aspect-square rounded-[3px]",
            ACCENTED_CELLS[i] ? ACCENTED_CELLS[i] : "bg-line",
            PULSING_CELLS.has(i) && "animate-pulse",
          )}
        />
      ))}
    </div>
  );
}

const ACTORS = [
  {
    icon: Camera,
    label: "Citizen",
    text: "Reports what's broken, with a photo and a pin on the map.",
  },
  {
    icon: ClipboardCheck,
    label: "Officer",
    text: "Verifies the evidence, does the work, posts the update.",
  },
  {
    icon: BarChart3,
    label: "Admin",
    text: "Oversees every zone, sets SLAs, rules on disputes.",
  },
];

const LIFECYCLE = [
  { key: "SUBMITTED", label: "Submitted", color: "bg-status-submitted" },
  { key: "UNDER_REVIEW", label: "Under review", color: "bg-status-under_review" },
  { key: "IN_PROGRESS", label: "In progress", color: "bg-status-in_progress" },
  { key: "RESOLVED", label: "Resolved", color: "bg-status-resolved" },
  { key: "CLOSED", label: "Closed", color: "bg-status-closed" },
];

const TRUST_POINTS = [
  {
    icon: EyeOff,
    label: "Identity stays private",
    text: "Officers never see who filed a complaint — only the evidence.",
  },
  {
    icon: Sparkles,
    label: "AI helps, never blocks",
    text: "Photo screening assists triage and steps aside gracefully when it's unavailable.",
  },
  {
    icon: ScrollText,
    label: "Nothing is ever erased",
    text: "Every status change is a permanent, append-only record.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-brand size-6" aria-hidden="true" />
          <span className="font-display text-lg font-semibold">Kartavya</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/login"
            className="text-ink-muted px-3 py-2 text-sm font-medium hover:text-ink"
          >
            Sign in
          </Link>
          <LinkButton to="/register" size="sm">
            Get started
          </LinkButton>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:py-24">
          <div>
            <h1 className="font-display text-display-lg md:text-display-xl font-semibold text-balance">
              What gets seen, gets fixed.
            </h1>
            <p className="text-ink-muted mt-5 max-w-md text-lg">
              Kartavya turns a photo of a civic problem into a transparent, accountable
              record — from the first report to the final fix.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton to="/register" size="lg">
                Report an issue
              </LinkButton>
              <LinkButton to="/login" variant="outline" size="lg">
                Sign in
              </LinkButton>
            </div>
          </div>
          <div className="order-first md:order-last">
            <HeroGrid />
          </div>
        </section>

        {/* Three-actor flow */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid gap-8 md:grid-cols-3 md:gap-4">
              {ACTORS.map((actor, i) => (
                <div
                  key={actor.label}
                  className="relative flex flex-col items-center text-center"
                >
                  <div className="bg-brand/10 mb-4 flex size-14 items-center justify-center rounded-full">
                    <actor.icon className="text-brand size-6" aria-hidden="true" />
                  </div>
                  <p className="font-display text-lg font-semibold">{actor.label}</p>
                  <p className="text-ink-muted mt-1.5 max-w-[22ch] text-sm">
                    {actor.text}
                  </p>
                  {i < ACTORS.length - 1 && (
                    <ArrowRight
                      className="text-ink-faint absolute top-7 -right-2 hidden size-5 -translate-y-1/2 md:block"
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FSM lifecycle strip */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-ink-faint text-center text-sm font-medium tracking-wide uppercase">
            Every complaint's journey
          </p>
          <div className="mt-8 flex items-center justify-between gap-1 overflow-x-auto pb-2 sm:gap-2">
            {LIFECYCLE.map((step, i) => (
              <div key={step.key} className="flex flex-1 items-center gap-1 sm:gap-2">
                <div className="flex min-w-[4.5rem] flex-col items-center gap-2 sm:min-w-[6rem]">
                  <span
                    className={cn("size-3.5 rounded-full", step.color)}
                    aria-hidden="true"
                  />
                  <span className="text-ink-muted text-center text-xs font-medium whitespace-nowrap sm:text-sm">
                    {step.label}
                  </span>
                </div>
                {i < LIFECYCLE.length - 1 && (
                  <span className="bg-line h-px flex-1" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          <p className="text-ink-faint mx-auto mt-6 max-w-lg text-center text-sm">
            Not fixed properly? Citizens can reopen it. Evidence doesn't hold up? Officers
            can reject it. Every branch is recorded.
          </p>
        </section>

        {/* Trust strip */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid gap-8 sm:grid-cols-3">
              {TRUST_POINTS.map((point) => (
                <div key={point.label}>
                  <point.icon className="text-brand size-5" aria-hidden="true" />
                  <p className="mt-3 font-display text-base font-semibold">
                    {point.label}
                  </p>
                  <p className="text-ink-muted mt-1 text-sm">{point.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <p className="font-display text-display-sm font-semibold">
            Something in your ward needs fixing?
          </p>
          <div className="mt-6">
            <LinkButton to="/register" size="lg">
              Report an issue
            </LinkButton>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-6 py-8">
        <div className="text-ink-faint mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-sm sm:flex-row">
          <span>Kartavya — a civic accountability platform.</span>
          <div className="flex gap-4">
            <Link to="/login" className="hover:text-ink">
              Sign in
            </Link>
            <Link to="/register" className="hover:text-ink">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
