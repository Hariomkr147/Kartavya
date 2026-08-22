# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Kartavya is a gamified civic grievance platform (citizens report infrastructure problems, officers resolve them, admins run the system, points/badges reward participation). It is a monorepo with a **contract-first** design: `backend/api/openapi.yaml` (OpenAPI 3.0.3, `info.version` 3.0.0, 45 paths) and `backend/database/schema.dbml` are the single source of truth for the whole system.

Both halves are now implemented:

- **`backend/`** — Flask + SQLAlchemy + SQLite, fully built out through all 8 phases (auth, complaint core, officer flow, clusters, gamification, admin, AI + jobs). All 45 contract paths have real handlers; no route returns `501` any more. `app/api/shared/responses.py` still defines the `NotImplementedYet` / `todo()` helper but nothing calls it — it is dead scaffolding.
- **`frontend/`** — React 19 + Vite + TypeScript + Tailwind CSS v4, no UI component library (all interactive components are bespoke, under `frontend/src/components/ui/`). ~52 hooks, each exercising a real endpoint. Ships with an MSW mock layer (`frontend/src/mocks/`) that is still the **default** (`VITE_USE_MOCKS=true` in `.env.development`).

**Before writing any implementation code, read `backend/api/openapi.yaml` and `backend/database/schema.dbml`.** If a field, endpoint, or behavior isn't in one of these two files, do not invent it — raise it instead of guessing.

### ⚠ Stale documentation

Several docs predate the backend implementation and will actively mislead you. Trust the code and the contract over them:

- `docs/start_here.md` — describes both halves as "scaffold-only" with an MVC `controllers/views/middlewares` layout, and cites contract version 2.0.0. All wrong.
- `backend/README.md` — says "Scaffolded, not implemented," with a `what is written / what is not` table and a build-order roadmap that is now entirely complete. Its *rules* and *frontend-mock-as-spec* sections are still good; its status claims are not.
- `CONTRIBUTING.md` §10 — says frontend types are mirrored "manually until a code generator is set up." One exists: `npm run gen:types`.
- `old_test.py` at the repo root is orphaned cruft — it imports `app.*` but sits outside `backend/`, so pytest never collects it.

## Commands

Run backend commands from `backend/`, frontend commands from `frontend/`.

### Backend

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env                  # dev defaults work as-is

# The initial migration is checked in — just apply it. If you WRITE a new one,
# read migrations/README.md first: the partial catch-all index is the piece
# autogenerate still gets wrong.
alembic upgrade head
flask --app app seed --demo           # mandatory: 12 categories, 6 badges, catch-all zone, settings, admin

flask --app app run                   # http://localhost:5000, health at /health
```

Checks:

```bash
pytest                                        # whole suite
pytest tests/domain                           # fast half — no database, milliseconds
pytest tests/api/test_privacy.py              # a single file
pytest tests/api/test_privacy.py::test_name   # a single test
pytest -m domain                              # by marker
pytest tests/integration                      # end-to-end journeys, ~2 min
pytest -m "not integration"                   # everything else, when iterating
pytest --cov                                  # coverage (source = app)
lint-imports --config .importlinter            # layering rules — see below
ruff check . && ruff format .
```

`pip install -e ".[contract]"` adds schemathesis for property-based fuzzing of the whole surface. It is deliberately opt-in and heavy; `tests/contract/` (PyYAML + jsonschema) is in the default dev install and validates live responses against `openapi.yaml` directly.

### Frontend

```bash
npm install
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b, then production build
npm run lint           # ESLint
npm run format         # Prettier (format:check to verify only)
npm test               # Vitest + React Testing Library, single run
npm run test:watch     # watch mode (test:ui for the Vitest UI)
npm test -- src/lib/categoryMatcher.test.ts    # a single file
npm test -- -t "<test name substring>"         # a single test by name
npm run gen:types      # regenerate src/types/api.generated.ts from ../backend/api/openapi.yaml
```

Re-run `gen:types` any time the contract changes.

### Running the frontend against the real backend

The frontend defaults to mocks. To point it at a live backend, create `frontend/.env.local`:

```
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

Backend `CORS_ORIGINS` already allows `http://localhost:5173`. "The whole app works with mocks off" is the integration gate worth aiming at — it exercises the contract in a way unit tests cannot.

## Architecture

### Backend layering (`docs/backend/architecture.md` is the design doc — read it before backend work)

Imports flow in exactly one direction, and this is **enforced in CI** by `.importlinter`, which defines four contracts:

```
app.api  →  app.services  →  app.models  →  app.domain
```

1. **Layered architecture** — the chain above, no upward imports.
2. **Domain is pure** — `app/domain/` may not import flask, sqlalchemy, `app.models`, `app.services`, `app.api`, `app.core`, or `app.infra`. No clock, no I/O. This is what keeps `tests/domain/` in the millisecond range.
3. **Serializers never touch the ORM session** — no serializer may import `app.extensions` or `app.services`.
4. **Reporter identity is admin-only** — `citizen`/`officer`/`shared` serializers may not import `app.api.admin.serializers`.

Package roles:

- `app/domain/` — pure rules: the state machine, SLA arithmetic, severity, points, badges, geo, the 11 enums.
- `app/models/` — SQLAlchemy ORM, all 14 tables, one shared package (not split per feature).
- `app/services/` — the write side, grouped by aggregate (`complaints/`, `accounts/`, `gamification/`, `analytics/`), plus most of the read side (`complaints/reads.py`, `views.py`, `feed.py`, `cluster_reads.py`) and shared query builders in `queries.py`.
- `app/api/` — HTTP surface + serialization, grouped **by audience** (`citizen/`, `officer/`, `admin/`, `account/`, `auth/`, `reference/`, `shared/`) because privacy is the risk. Every blueprint mounts under `/api/v1`; `/health` deliberately sits outside it.
- `app/core/` — auth (JWT), zone scoping, error envelope, Pydantic validation, photo-URL signing, transaction helper.
- `app/infra/` — photo storage and the AI provider adapter (`local` / `stub` / `remote` / `null`, behind a circuit breaker).
- `app/jobs/` — AI screening, zone reports, the auto-close sweeper, and an APScheduler-based scheduler.

There is no `app/api/ai/` package — contract 3.0.0 has no `/ai/*` paths. The zone report lives at `/admin/zones/{id}/ai-report`, and the AI *adapter* is in `app/infra/ai/`.

### Roles

Three roles with strictly separated views — enforced in both backend authorization and frontend routing:

- **Citizen** — files complaints, tracks their own, upvotes, confirms fixes, earns points/badges. Sees only their own data plus the anonymized public `/feed`.
- **Officer** — scoped to exactly one assigned zone (`users.zone_id`). Reviews evidence, drives the lifecycle, posts progress notes. Never sees who filed a complaint, never sees other zones or admin data.
- **Admin** — full cross-zone access: user/zone/SLA management, analytics, CSV export, AI zone reports. Invisible to citizens/officers.

Auth is JWT bearer on every endpoint except `/auth/register`, `/auth/login`, and the public reference lookups (`/categories`, `/zones`) needed by the registration form.

### Complaint lifecycle (server-enforced state machine)

`complaint_status` in `schema.dbml` is the authority: `SUBMITTED → EVIDENCE_UNDER_REVIEW → (NEEDS_MORE_EVIDENCE | REJECTED | UNDER_REVIEW) → IN_PROGRESS → UNDER_RESOLUTION → RESOLVED → (CLOSED | REOPENED) ...`, plus terminal `UNRESOLVABLE`. `REJECTED`, `CLOSED`, `UNRESOLVABLE` are terminal.

Every transition is an append-only row in `status_history`. The SLA timer starts at `UNDER_REVIEW` and pauses while a complaint sits in `NEEDS_MORE_EVIDENCE` (`sla_paused_seconds`/`sla_paused_at`) — paused time must never count against the SLA.

### Derived-not-stored fields

Never add a stored column/field for something computable — a deliberate schema principle so values can't drift:

- `severity_label` derived from `complaints.severity_score` on read (LOW 0-4, MEDIUM 5-14, HIGH 15-29, CRITICAL 30+).
- `sla_label` (`ON_TIME`/`DELAYED`/`OVERDUE`) derived from `sla_target_hours`, `sla_started_at`, `sla_paused_seconds`.
- Lifetime/monthly citizen points are `SUM(points_ledger.points_change)`.
- `upvoteCount` is `COUNT(*)` on `complaint_upvotes`.

### Append-only ledgers

`status_history`, `points_ledger`, and `complaint_evidence` (each re-submission is a new row via `sequence`) are audit trails. Insert new rows; never update or delete historical ones.

### Zones

Zones are admin-managed areas defined only by a centre point (`center_lat`/`center_lng`); a location belongs to whichever zone's centre is nearest (nearest-centroid / Voronoi — no radius, no polygon GIS, every coordinate maps to exactly one zone with no gaps or overlaps). Exactly one zone has `is_catch_all = true`, used when every real zone's centre is a poor match. **This constraint is a partial unique index, not a column constraint** — Alembic will not autogenerate it.

Zone routing is always citizen-confirmed at submission (client auto-fills via `/zones/suggest` from photo EXIF GPS, or the citizen picks manually — `CreateComplaintRequest.zoneId` is required, never silently derived by the server) and can be admin-overridden, but is otherwise immutable: editing a zone's centre does not retroactively move existing complaints.

### AI features fail soft

Exactly two AI features: photo pre-screening (`complaint_evidence.ai_screen_status`) and zone health reports (`ai_zone_reports`). Both degrade gracefully when the model is unavailable — fields flagged `UNAVAILABLE` / `aiAvailable: false` rather than erroring. AI never raises and never blocks a core flow; its failure mode is `None`.

Category suggestion is deliberately **not** an AI feature and has no endpoint. The 12 categories are seeded once and never change, so the client matches the description against a fixed keyword lexicon offline in `frontend/src/lib/categoryMatcher.ts`, keyed on `Category.code`. It abstains unless the top category clears both an absolute score floor and a margin over the runner-up — a wrong pre-selection is worse than none, since the citizen confirms either way. `complaints.category_suggested_by_matcher` records acceptance for analytics only; the server never re-derives it.

### Privacy rules (enforce on backend and frontend)

- Reporter identity is never exposed to officers, other citizens, or the public feed. The API strips it; don't reintroduce it via frontend local state or joins.
- Officers are identified to citizens by ID, not name.
- `users.full_name` is never shown to other citizens or officers; `display_name` (with a masked fallback) is the only public handle.
- Photo URLs are minted only by a serializer, after the visibility check. The photo route verifies the signature alone and answers `403` — never `404` — for anything it won't serve.

## The rules most likely to bite you

The full list of fourteen is in `docs/backend/architecture.md` §16.4. These cause silent data corruption rather than a visible error:

1. **Every status write goes through `app/services/complaints/lifecycle.py`.** Nothing else may assign `complaint.status`. The `status_history` row is written inside `apply_transition()`, which is what makes an unaudited status change structurally impossible.
2. **Guard every transition with a conditional `UPDATE ... WHERE status = <expected>`.** `rowcount` is the decision, not a preceding `if`. Two officers *will* claim the same complaint at the same moment.
3. **The cluster's +50 reward is an atomic test-and-set on `reward_granted`**, in the same transaction as the close. A read-then-write pays it twice.
3b. **A terminal complaint leaves its cluster, but the cluster row is never deleted.** `apply_transition()` calls `clusters.exit_cluster()` on any move to CLOSED/REJECTED/UNRESOLVABLE — otherwise finished reports keep inflating `report_count`/`unique_reporter_count`/severity and clusters whose members have all finished never leave the cluster pages. Two consequences to hold onto: the id moves to `complaints.former_cluster_id`, and **every reward guard must read `cluster_id or former_cluster_id`** (a paid complaint has since left, and a guard that only sees current members pays the same citizen twice); and the `complaint_clusters` row survives even with zero members, because it holds the one-time `reward_granted` latch. A cluster with no live members is *dissolved* — hidden by `core/scoping.visible_clusters`, not deleted. `flask --app app verify-clusters [--repair]` checks and repairs the drift.
4. `REJECTED` is legal only on a complaint's first evidence round (`sla_started_at IS NULL`).
5. `REOPENED` may only be moved by the admin dispute-review endpoint — never by the status, batch, or cascade paths.
6. **Re-load the user row on every request.** Never authorize from JWT claims alone: a deactivated user and a reassigned officer must both take effect immediately.
7. `PRAGMA foreign_keys=ON` must be on, or every FK rule in the schema is inert.
8. Auto-close and admin-rejected disputes credit **zero** points.
9. `avgResolutionHours` is `resolved_at − sla_started_at − sla_paused_seconds` in all three dashboards — never `closed_at − created_at`. The wait between "officer fixed it" and "citizen confirmed it" is not the officer's to answer for.
10. **The SLA clock starts once.** `review_evidence()` may only call `sla.start()` when `sla_started_at IS NULL` — a `VALID` verdict is also how a complaint returns from an officer's post-acceptance recall, and restarting there both hands back a fresh deadline and double-discounts the paused span.
11. **An admin may not deactivate or delete the last way back in.** `PATCH`/`DELETE /admin/users/{id}` answer `409 LAST_ADMIN` when the target is the caller's own admin account, or the only remaining active one. There is no API that mints an ADMIN (`CreateUserRequest.role` is `CITIZEN`/`OFFICER`), and a deactivated account cannot log in, so one unguarded `PATCH` strands the whole admin surface with no recovery short of database surgery.

### Where the mock and the contract can drift

The mock (`frontend/src/mocks/`) is the default in development (`VITE_USE_MOCKS=true`), so anywhere it is *more permissive* than the backend is a bug a client can only discover in production. Two real ones shipped this way: it let admins read `/leaderboard` when the contract said citizens-only, and it accepted unrecognised request enums — an unknown evidence verdict drove a complaint to terminal REJECTED with a 200 in reply.

`mocks/lib/enums.ts` now guards every enum-valued body field and query parameter; keep its lists identical to `openapi.yaml`. Two known, deliberate gaps remain, both in the same permissive direction:

- Pagination is clamped (`page=0` → 1, `pageSize=9999` → 100) where the backend's `ge=1, le=100` returns `400`.
- Unknown body/query fields are ignored where the backend's `extra="forbid"` returns `400`.

## Testing layout

- `tests/domain/` — pure rules, no database, must stay in the millisecond range (marker: `domain`).
- `tests/services/` — in-memory SQLite, aggregate behavior and regression locks.
- `tests/api/` — Flask test client, including explicit privacy assertions (`test_privacy.py`) and JWT security (`test_jwt_security.py`).
- `tests/contract/` — validates live responses against `openapi.yaml` itself rather than hand-copied expectations. This layer exists because three contract violations shipped while it was optional; it is now in the default dev install.
- `tests/unit/`, `tests/jobs/` — AI providers and background jobs.
- `tests/integration/` — end-to-end journeys (marker: `integration`). Distinct from `tests/api/` in one rule: **nothing sets a scenario up through the database.** Every actor logs in and every row is produced by the same requests a browser sends — admin creates the zones and officers, citizens register and file, officers drive the lifecycle. That is what makes states reachable only through six earlier calls (a resumed SLA clock, a cluster's second confirm, an upheld dispute) testable at all. Runs on file-backed SQLite, and honours `TEST_DATABASE_URL` so the same journeys can be pointed at Postgres (that hook exists but has not been exercised against a live Postgres yet). The two sanctioned back doors are `Platform.db_shift()` (moves stored timestamps backwards — the SLA clock and the auto-close timeout are otherwise unreachable) and `Platform.rows()` (reads only).

A cheap, high-value test for any officer route: `assert "reporter" not in response.get_json()`.

## Frontend conventions

- `components/` — presentational only, must not call the API directly.
- `hooks/` — state + side effects, including API calls (TanStack Query).
- `pages/` — one folder per route, grouped by audience (`citizen/`, `officer/`, `admin/`, `account/`, `public/`).
- `services/` — the only place raw fetch calls live (`http.ts` is the shared client).
- `types/` — `api.generated.ts` is generated by `npm run gen:types`; do not hand-edit it. `api.ts` holds hand-written types on top.
- `lib/` — pure client-side logic (category matching, SLA progress, geo, EXIF GPS, CSV export). Mirrors several `app/domain/` rules.
- `mocks/` — MSW handlers plus a TypeScript port of the business rules, with its own integration suite.

## Workflow rules (from `CONTRIBUTING.md`)

Two long-lived branches, **both protected**:

- **`development`** — the integration branch. All feature branches are cut from here and PR'd back into here.
- **`main`** — the release branch. It only ever receives merges from `development`, at checkpoints the repo owner decides.

Never commit directly to either. Never open a feature PR against `main` — the base branch is always `development`.

- Branch naming: `<type>/<short-description>` (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), e.g. `feat/complaint-submission`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <imperative summary>`, summary line ≤72 chars, lowercase, no trailing period. Scope is the touched area (`auth`, `complaints`, `evidence`, `gamification`, `schema`, `openapi`, `frontend`, ...).
- Update your branch with **rebase**, not merge (`git rebase origin/development`, or `git rebase upstream/development` for forks), then force-push with `--force-with-lease` (never plain `--force`).
- One concern per PR; keep backend and frontend changes in separate PRs unless tightly coupled.
- Any change to `openapi.yaml` or `schema.dbml` must keep the other in sync — they're designed 1:1. Re-run `npm run gen:types` afterwards.
- Do not merge your own PR; at least one other team member must approve.
- Never commit `.env` or `*.sqlite3` — both are already in `.gitignore`.
