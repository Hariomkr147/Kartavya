# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Kartavya is a gamified civic grievance platform (citizens report infrastructure problems, officers resolve them, admins run the system, points/badges reward participation). The repository is **contract-first and currently scaffold-only**:

- `backend/api/openapi.yaml` and `backend/database/schema.dbml` are fully designed and are the single source of truth for the whole system.
- `backend/app/*` (config, controllers, middlewares, models, routes, services, views) and `frontend/src/*` (assets, components, hooks, pages, routes, services, types) contain only `.gitkeep` placeholders — no application code has been implemented yet, and no `package.json` / `requirements.txt` / build tooling exists in the repo yet.
- There are no build/lint/test commands to run yet because there is no application code. When implementing the backend or frontend for the first time, set up the toolchain (Flask + SQLAlchemy + SQLite for backend per the schema notes; React + Vite/TS implied by the `frontend/src` layout) consistent with `CONTRIBUTING.md` before writing app code, and update this file with the actual commands once they exist.

**Before writing any implementation code, read `backend/api/openapi.yaml` and `backend/database/schema.dbml` in full.** If a field, endpoint, or behavior isn't in one of these two files, do not invent it — raise it instead of guessing.

## Architecture (from the contract + schema)

### Roles
Three roles with strictly separated views — enforce this in both backend authorization and frontend routing:
- **Citizen** — files complaints, tracks their own, upvotes, confirms fixes, earns points/badges. Sees only their own data plus the anonymized public `/feed`.
- **Officer** — scoped to exactly one assigned zone (`users.zone_id`). Reviews evidence, drives the complaint lifecycle, posts progress notes. Never sees who filed a complaint (citizen identity is stripped), never sees other zones or admin data.
- **Admin** — full cross-zone access: user/zone/SLA management, analytics, CSV export, AI zone reports. Invisible to citizens/officers.

Auth is JWT bearer (`Authorization: Bearer <token>`) on every endpoint except `/auth/register`, `/auth/login`, and the public reference lookups (`/categories`, `/zones`) needed for the registration form.

### Complaint lifecycle (server-enforced state machine)
`complaint_status` in `schema.dbml` is the authority: `SUBMITTED → EVIDENCE_UNDER_REVIEW → (NEEDS_MORE_EVIDENCE | REJECTED | UNDER_REVIEW) → IN_PROGRESS → UNDER_RESOLUTION → RESOLVED → (CLOSED | REOPENED) ...`, plus terminal `UNRESOLVABLE`. `REJECTED`, `CLOSED`, `UNRESOLVABLE` are terminal. Every transition is recorded as an append-only row in `status_history` (never mutate/delete history rows). The SLA timer starts at `UNDER_REVIEW` and pauses while a complaint sits in `NEEDS_MORE_EVIDENCE` (`sla_paused_seconds`/`sla_paused_at`) — paused time must never count against the SLA.

### Derived-not-stored fields
Never add a stored column/field for something computable — this is a deliberate schema principle so values can't drift out of sync:
- `severity_label` is derived from `complaints.severity_score` on read (LOW 0-4, MEDIUM 5-14, HIGH 15-29, CRITICAL 30+), never stored.
- `sla_label` (`ON_TIME` / `DELAYED` / `OVERDUE`) is derived on read from `sla_target_hours`, `sla_started_at`, `sla_paused_seconds` — never stored.
- Lifetime/monthly citizen points are `SUM(points_ledger.points_change)`, never a stored total.
- `upvoteCount` is `COUNT(*)` on `complaint_upvotes`.

### Append-only ledgers
`status_history`, `points_ledger`, and `complaint_evidence` (each re-submission is a new row via `sequence`, old rows kept) are append-only audit trails. Insert new rows; do not update or delete historical ones.

### AI features fail soft
Photo pre-screening (`complaint_evidence.ai_screen_status`), category suggestion (`/ai/suggest-category`), and zone health reports (`ai_zone_reports`) must degrade gracefully when the local AI model is unavailable — the app must keep working with fields flagged `UNAVAILABLE`/`aiAvailable: false` rather than erroring. Never block a core flow on AI availability.

### Zones
Zones are admin-managed areas defined only by a centre point (`center_lat`/`center_lng`); a location belongs to whichever zone's centre is nearest (nearest-centroid / Voronoi-style — no radius, no polygon GIS, and every coordinate maps to exactly one zone with no gaps or overlaps). Exactly one zone has `is_catch_all = true`, used when every real zone's centre is a poor match (e.g. far outside the city). Zone routing on a complaint is always citizen-confirmed at submission time (client auto-fills via `/zones/suggest` from photo EXIF GPS, or the citizen picks manually — `CreateComplaintRequest.zoneId` is required, never silently derived from location by the server) and can be admin-overridden, but is otherwise immutable — an admin editing a zone's centre does not retroactively move existing complaints.

### Privacy rules (enforce on both backend and frontend)
- Complaint reporter identity is never exposed to officers, admins-as-viewed-by-others, or the public feed — the API strips it; don't reintroduce it via frontend local state or joins.
- Officers are identified to citizens by ID, not name.
- `users.full_name` is never shown to other citizens or officers; `display_name` (with a masked fallback) is the only public handle.

## Repository layout

```
backend/
  api/openapi.yaml        # canonical API contract — read first
  database/schema.dbml     # DBML schema, designed 1:1 against the API contract
  app/                      # Flask app (scaffold only): config, controllers, middlewares, models, routes, services, views
  tests/                    # scaffold only
frontend/
  src/                      # React SPA (scaffold only): assets, components, hooks, pages, routes, services, types
shared/contracts/          # reserved for cross-cutting contracts; currently empty
docs/
  start_here.md             # repo overview / current status
  backend/database.md       # detailed schema reference (backend/api.md is currently empty)
```

Frontend folder conventions (per `CONTRIBUTING.md`, apply once code exists):
- `components/` — presentational only, must not call the API directly.
- `hooks/` — state + side effects, including API calls.
- `pages/` — one folder per route, composes components/hooks.
- `services/` — the only place raw fetch/axios calls live.
- `types/` — TS interfaces mirrored manually from `components/schemas` in `openapi.yaml`.

## Workflow rules (from `CONTRIBUTING.md`)

- **Never commit directly to `main`** — it's protected; all changes go through a reviewed PR from a feature branch.
- Branch naming: `<type>/<short-description>` (types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`), e.g. `feat/complaint-submission`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <imperative summary>`, summary line ≤72 chars, no trailing period. Scope is the touched area (`auth`, `complaints`, `evidence`, `gamification`, `schema`, `openapi`, `frontend`, ...).
- Update your branch with **rebase**, not merge (`git rebase origin/main` or `git rebase upstream/main` for forks), then force-push with `--force-with-lease` (never plain `--force`).
- One concern per PR; keep backend and frontend changes in separate PRs unless tightly coupled.
- Any change to `openapi.yaml` or `schema.dbml` must keep the other in sync — they're designed 1:1.
- Do not merge your own PR; at least one other team member must approve.
