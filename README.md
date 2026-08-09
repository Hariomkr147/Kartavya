# Kartavya

**Kartavya** is a gamified civic grievance platform. Citizens report infrastructure problems
(potholes, open manholes, broken street lights, …) with a photo and a location, ward officers
work them through an audited lifecycle under an SLA clock, and admins run the system. Citizens
earn Community Service Points and badges for reports that turn into real fixes.

The repository is a monorepo with a **contract-first** design: `backend/api/openapi.yaml`
(OpenAPI 3.0.3, 45 paths) and `backend/database/schema.dbml` are the single source of truth for
both halves. Both halves are implemented — a Flask API and a React SPA that also runs
standalone against a mock layer.

---

## Table of contents

- [Kartavya](#kartavya)
  - [Table of contents](#table-of-contents)
  - [What's in the box](#whats-in-the-box)
  - [Tech stack](#tech-stack)
  - [Repository layout](#repository-layout)
  - [Quick start](#quick-start)
    - [Option A — frontend only (mocks, no backend)](#option-a--frontend-only-mocks-no-backend)
    - [Option B — the full stack](#option-b--the-full-stack)
  - [Backend setup, step by step](#backend-setup-step-by-step)
  - [Frontend setup, step by step](#frontend-setup-step-by-step)
  - [Connecting the frontend to the real backend](#connecting-the-frontend-to-the-real-backend)
  - [Accounts](#accounts)
    - [Real backend](#real-backend)
    - [Mock accounts (frontend only)](#mock-accounts-frontend-only)
  - [Configuration](#configuration)
    - [Backend (`backend/.env`, see `.env.example` for the annotated original)](#backend-backendenv-see-envexample-for-the-annotated-original)
    - [Frontend](#frontend)
  - [Tests and checks](#tests-and-checks)
  - [Working with the contract](#working-with-the-contract)
  - [Deployment](#deployment)
  - [Troubleshooting](#troubleshooting)
  - [Documentation](#documentation)
  - [Contributing](#contributing)
  - [License](#license)

---

## What's in the box

Three roles, with strictly separated views enforced in both the API and the routing layer:

| Role | Can do |
|---|---|
| **Citizen** | File complaints with photo evidence, track their own, upvote others on an anonymized public feed, confirm or dispute a fix, earn points and badges. |
| **Officer** | Scoped to exactly one zone. Reviews evidence, drives the lifecycle, posts progress notes, works nearby complaints as a cluster. Never sees who filed a complaint. |
| **Admin** | Cross-zone: users, zones, per-category SLAs, settings, dispute review, analytics, CSV export, AI zone health reports. |

Core mechanics:

- **A server-enforced state machine.** `SUBMITTED → EVIDENCE_UNDER_REVIEW → (NEEDS_MORE_EVIDENCE |
  REJECTED | UNDER_REVIEW) → IN_PROGRESS → UNDER_RESOLUTION → RESOLVED → (CLOSED | REOPENED)`,
  plus terminal `UNRESOLVABLE`. Every transition is an append-only row in `status_history`.
- **An SLA clock** that starts at `UNDER_REVIEW` and pauses while a complaint waits on more
  evidence, so time spent waiting on the citizen never counts against the officer.
- **Clusters.** Complaints of the same category within a radius are linked, worked as a batch,
  and pay a one-time bonus when the cluster closes.
- **Zones as Voronoi cells.** A zone is just a centre point; a location belongs to the zone whose
  centre is nearest. Exactly one catch-all zone absorbs everything else — no gaps, no overlaps.
- **Gamification.** A points ledger, six badges, and zone/global leaderboards.
- **Two AI features that fail soft** — photo pre-screening and zone health reports. When the model
  is unavailable they report `UNAVAILABLE` rather than erroring; AI never blocks a core flow.

## Tech stack

| | |
|---|---|
| **Backend** | Python 3.11+, Flask 3, SQLAlchemy 2, SQLite, Alembic, Pydantic, PyJWT, APScheduler |
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, React Router 7, React Hook Form + Zod, Leaflet, Recharts, Framer Motion |
| **Contract** | OpenAPI 3.0.3 + DBML, with TypeScript types generated from the spec |
| **Testing** | pytest (domain / services / api / contract / jobs), Vitest + React Testing Library, MSW |
| **Quality** | Ruff, import-linter (layering enforced in CI), ESLint, Prettier |

## Repository layout

```text
MAY2026-Team-040/
├── backend/
│   ├── api/openapi.yaml          # ← source of truth: the API contract (45 paths)
│   ├── database/schema.dbml      # ← source of truth: 14 tables, 11 enums
│   ├── app/
│   │   ├── domain/               # pure rules — FSM, SLA, severity, points, badges, geo (no I/O)
│   │   ├── models/               # SQLAlchemy ORM, all 14 tables
│   │   ├── services/             # write side + most reads, grouped by aggregate
│   │   ├── api/                  # HTTP surface, grouped by AUDIENCE (citizen/officer/admin/…)
│   │   ├── core/                 # JWT auth, zone scoping, error envelope, photo-URL signing
│   │   ├── infra/                # photo storage, AI provider adapter (circuit-breakered)
│   │   ├── jobs/                 # AI screening, zone reports, auto-close sweeper, scheduler
│   │   └── seed.py               # mandatory reference data
│   ├── migrations/               # Alembic — the initial schema revision is checked in
│   └── tests/                    # domain / services / api / contract / unit / jobs
├── frontend/
│   └── src/
│       ├── pages/                # one folder per audience: citizen/ officer/ admin/ account/ public/
│       ├── components/           # presentational only — never calls the API
│       ├── hooks/                # state + side effects (TanStack Query), one per endpoint
│       ├── services/             # the only place raw fetch lives
│       ├── lib/                  # pure client logic (category matching, SLA, geo, EXIF, CSV)
│       ├── types/api.generated.ts# generated from openapi.yaml — do not hand-edit
│       └── mocks/                # MSW handlers + a TS port of the business rules
├── docs/                         # architecture, API and database references
├── shared/contracts/             # reserved (currently empty)
├── render.yaml                   # Render blueprint for deploying the backend
├── CONTRIBUTING.md               # branching, commits, PR rules — read before your first PR
└── CLAUDE.md                     # working notes for AI assistants
```

## Quick start

**Prerequisites**

- **Python 3.11 or newer** (backend)
- **Node.js 20 or newer** and npm (frontend)
- Git

Nothing else — the database is a SQLite file, and there is no Docker, Redis, or message broker.

### Option A — frontend only (mocks, no backend)

The fastest way to see the whole product. The app ships with an MSW mock layer that implements
the business rules in TypeScript and seeds a populated demo database in the browser, and it is
**on by default**.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> and log in with any account from
[Mock accounts](#mock-accounts-frontend-only) — e.g. `aditi@example.com` / `password123`.

### Option B — the full stack

Two terminals. Backend first.

```bash
# terminal 1 — API on http://localhost:5000
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cp .env.example .env                                  # Windows PowerShell: copy .env.example .env
alembic upgrade head
flask --app app seed --demo
flask --app app run
```

```bash
# terminal 2 — SPA on http://localhost:5173, talking to the API
cd frontend
npm install
printf 'VITE_USE_MOCKS=false\nVITE_API_BASE_URL=http://localhost:5000/api/v1\n' > .env.local
npm run dev
```

Register a citizen from the sign-up page, or log in as the seeded admin
(`admin@kartavya.gov` / `changeme123`) to create officers.

---

## Backend setup, step by step

Run everything from `backend/`.

**1. Virtual environment and dependencies**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
                                 # Windows cmd:        .venv\Scripts\activate.bat
pip install -e ".[dev]"
```

`[dev]` includes pytest, coverage, Ruff, import-linter, and the contract-test dependencies.
`pip install -e ".[contract]"` additionally installs schemathesis for property-based fuzzing of
the whole surface — deliberately opt-in, because it is heavy.

**2. Environment**

```bash
cp .env.example .env             # Windows PowerShell: copy .env.example .env
```

The development defaults work as-is; the SQLite file and upload directory are created for you
under `backend/instance/`. Outside development, `JWT_SECRET` and `PHOTO_SIGNING_KEY` **must** be
set — the app refuses to start rather than sign with a dev default. Never commit `.env`.

**3. Database**

The initial schema revision is checked in, so applying it is all you need:

```bash
alembic upgrade head
```

⚠ **If you ever write a new migration, read `backend/migrations/README.md` first.** Autogenerate
gets the catch-all zone index wrong: it must come out **partial**
(`... WHERE is_catch_all = 1`), because a plain unique index would also cap the table at one
non-catch-all row, blocking every real zone after the first.

The other historical trap — enum columns rendering as a bare `VARCHAR` instead of
`CHECK (col IN (...))`, which made a typo'd status storable — is now fixed at source by
`create_constraint=True` in `app/models/base.py`, so autogenerate carries it through on its own.

**4. Seed — mandatory**

```bash
flask --app app seed --demo
```

The application does not work without this. It inserts the 12 complaint categories (with their
default SLA hours), the 6 badges, the single catch-all zone, the app-settings row, and one admin
— admins have no creation endpoint, by design. `--demo` adds three example wards so you can file
a complaint immediately. The command is idempotent; re-running it changes nothing and never
resets the admin's password.

**5. Run**

```bash
flask --app app run
```

- API: <http://localhost:5000/api/v1>
- Health check: <http://localhost:5000/health> (deliberately outside `/api/v1`)

## Frontend setup, step by step

Run everything from `frontend/`.

```bash
cd frontend
npm install
npm run dev            # Vite dev server on http://localhost:5173
```

Other scripts:

```bash
npm run build          # tsc -b, then a production build
npm run preview        # serve the production build locally
npm run lint           # ESLint
npm run format         # Prettier (format:check to verify only)
npm run gen:types      # regenerate src/types/api.generated.ts from the OpenAPI contract
```

## Connecting the frontend to the real backend

Mock mode is the default (`VITE_USE_MOCKS=true` in `.env.development`). To point the app at a
running API, create **`frontend/.env.local`** (git-ignored):

```env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

Restart `npm run dev` afterwards — Vite reads env files at startup. The backend's default
`CORS_ORIGINS` already allows `http://localhost:5173`, so no proxy is needed.

> "The whole app works with mocks off" is the integration gate worth aiming at: it exercises the
> contract end to end in a way unit tests cannot.

## Accounts

### Real backend

| Role | How you get one |
|---|---|
| **Citizen** | Self-service — the sign-up page (`POST /auth/register`). The only self-service signup in the system. |
| **Officer** | Created by an admin (Admin → Officers), then assigned to exactly one zone. |
| **Admin** | Seeded only. `flask --app app seed` creates `admin@kartavya.gov` with password `changeme123` unless you set `KARTAVYA_ADMIN_EMAIL` / `KARTAVYA_ADMIN_PASSWORD` first. Change it before running this anywhere real — `render.yaml` generates a random one for deployed instances, readable from the service's Environment tab. |

### Mock accounts (frontend only)

With `VITE_USE_MOCKS=true`, every seeded account shares the password **`password123`**:

| Email | Role |
|---|---|
| `admin@kartavya.gov` | Admin |
| `officer.ward12@kartavya.gov` | Officer — Ward 12 North |
| `officer.ward07@kartavya.gov` | Officer — Ward 7 South |
| `officer.ward14@kartavya.gov` | Officer — Ward 14 Central |
| `aditi@example.com`, `asha@example.com`, `kiran@example.com`, … | Citizens |

These exist only in the browser's mock database and mean nothing to the real API.

## Configuration

### Backend (`backend/.env`, see `.env.example` for the annotated original)

| Variable | Default | Notes |
|---|---|---|
| `KARTAVYA_ENV` | `development` | `development` \| `testing` \| `production` |
| `DATABASE_URL` | `sqlite:///instance/kartavya.sqlite3` | Swapping to Postgres is a URL change |
| `JWT_SECRET` | dev placeholder | **Required** outside development; startup fails without it |
| `PHOTO_SIGNING_KEY` | dev placeholder | **Required** outside development. Deliberately a *different* secret — leaking the photo key must not let anyone mint an admin JWT |
| `JWT_TTL_HOURS` | `24` | |
| `PHOTO_URL_TTL_SECONDS` | `86400` | Signed photo URLs expire |
| `UPLOAD_DIR` | `instance/uploads` | Must sit outside the web root; never served statically |
| `MAX_UPLOAD_BYTES` | `5242880` | 5 MB per photo |
| `AI_PROVIDER` | `stub` | `local` \| `stub` \| `null` — `null` exercises every fail-soft path |
| `AI_SCREENING_ENABLED` | `true` | Turn pre-screening off without changing provider |
| `CLUSTER_RADIUS_METERS` | `100` | |
| `AUTO_CLOSE_SWEEP_MINUTES` | `15` | How often the auto-close sweeper runs |
| `CORS_ORIGINS` | `http://localhost:5173` | The Vite dev server |

### Frontend

| Variable | Default | Notes |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | Set to `false` in `.env.local` to talk to a real backend |
| `VITE_API_BASE_URL` | `/api/v1` | Use an absolute URL when mocks are off |

## Tests and checks

**Backend** (from `backend/`, venv active):

```bash
pytest                                        # the whole suite
pytest tests/domain                           # the fast half — no database, milliseconds
pytest -m domain                              # same, by marker
pytest tests/api/test_privacy.py              # a single file
pytest tests/api/test_privacy.py::test_name   # a single test
pytest --cov                                  # coverage (source = app)

lint-imports --config .importlinter            # layering rules, enforced in CI
ruff check . && ruff format .
```

`tests/contract/` validates live responses against `openapi.yaml` itself rather than against
hand-copied expectations, and it is in the default dev install — three contract violations
shipped while that layer was optional.

The import-linter contracts are worth knowing, because they encode two architectural decisions:

```
app.api  →  app.services  →  app.models  →  app.domain     (imports flow one way only)
```

`app/domain/` may not import Flask, SQLAlchemy, or any other app package — that purity is what
keeps `tests/domain/` in the millisecond range. And `citizen`/`officer`/`shared` serializers may
not import the admin serializers, which is how "reporter identity is admin-only" is enforced
structurally rather than by review.

**Frontend** (from `frontend/`):

```bash
npm test                                       # Vitest + React Testing Library, single run
npm run test:watch                             # watch mode (test:ui for the Vitest UI)
npm test -- src/lib/categoryMatcher.test.ts    # a single file
npm test -- -t "<test name substring>"         # a single test by name
npm run lint && npm run format:check
```

## Working with the contract

`backend/api/openapi.yaml` and `backend/database/schema.dbml` are designed 1:1 and outrank every
other document in this repository, including the docs under `docs/`.

- **Read them before writing implementation code.** If a field, endpoint, or behaviour isn't in
  one of the two, don't invent it — raise it.
- **A change to one must keep the other in sync**, and must be followed by
  `npm run gen:types` in `frontend/`.
- `frontend/src/types/api.generated.ts` is generated. Hand-written types layer on top of it in
  `api.ts`.

Two schema principles you will run into immediately:

- **Derived, never stored.** `severity_label`, `sla_label`, lifetime points, and upvote counts
  are all computed on read, so they cannot drift from the data they summarize.
- **Append-only ledgers.** `status_history`, `points_ledger`, and `complaint_evidence` are audit
  trails. Insert new rows; never update or delete historical ones.

## Deployment

The two halves deploy to two hosts, both on free tiers that need no credit card: the API to
**Render** (`render.yaml`) and the SPA to **Vercel** (`frontend/vercel.json`).

**Backend — Render.** Dashboard → **New +** → **Blueprint** → pick this repository (choose *only
select repositories* if it is private) → **Apply**. `render.yaml` builds from `backend/`, runs
`alembic upgrade head` → `flask --app app seed --demo` → gunicorn, and health-checks `/health`.
`JWT_SECRET`, `PHOTO_SIGNING_KEY`, and `KARTAVYA_ADMIN_PASSWORD` are generated by Render — read
the admin password from the service's **Environment** tab.

**Frontend — Vercel.** Dashboard → **Add New** → **Project** → import the repository, and set
**Root Directory** to `frontend`. The rest (framework, build command, output directory) comes
from `frontend/vercel.json`; the SPA rewrite in that file is what stops a refresh on a deep link
from 404ing. `frontend/.env.production` points the build at the deployed API and forces
`VITE_USE_MOCKS=false`.

**Then connect them.** Take the Vercel domain, put it in `CORS_ORIGINS` in `render.yaml`, and
push — Render re-syncs and redeploys. Until you do, every request from the browser is blocked.
That failure is easy to misread: the API answers `200` normally, and only the *browser* rejects
the response for a missing header, so it looks like a frontend bug. `CORS_ORIGINS` is matched
**exactly** — no wildcards, no subdomain matching — so Vercel preview deployments, which get a
unique URL per commit, are not covered unless you add one explicitly.

Two consequences of Render's free tier worth knowing before a demo:

- The service **spins down after ~15 minutes idle**, so the first request afterwards takes 30-50
  seconds. This is also why the frontend calls the API directly rather than proxying through a
  Vercel rewrite — a proxied request would hit Vercel's gateway timeout and return `504`, while
  the browser happily waits out a cold start.
- The disk is **ephemeral**. Every restart or redeploy wipes the SQLite file and the uploaded
  photos, then re-runs migrate + seed. Fine for a demo; don't prepare a scenario the night
  before and expect it to survive. A persistent disk or a managed Postgres is the fix if the
  data needs to last.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `flask: command not found` | The virtualenv isn't active. Re-run the activate line for your shell. |
| Startup aborts complaining about a secret | `KARTAVYA_ENV` isn't `development` and `JWT_SECRET` / `PHOTO_SIGNING_KEY` are unset. That check is deliberate. |
| Every request 500s, or the app has no categories/zones | You skipped `flask --app app seed`. It is mandatory. |
| Second real zone fails to insert | The catch-all index came out non-partial. See `migrations/README.md`. |
| A typo'd status saves successfully | An enum column rendered as bare `VARCHAR` instead of a `CHECK`. `enum_column()` in `app/models/base.py` must keep `create_constraint=True`. |
| Foreign keys appear not to be enforced | `PRAGMA foreign_keys=ON` isn't on — without it every FK rule in the schema is inert. |
| Frontend still shows demo data after pointing at the API | `.env.local` wasn't picked up. Vite reads env files at startup — restart `npm run dev`. |
| CORS errors in the browser console | Add the origin you're serving from to `CORS_ORIGINS` — `backend/.env` locally, `render.yaml` for the deployed API. Matched exactly, so the scheme and port count. |
| Deployed frontend shows a network error, but the API works in a browser tab | Same cause: the Vercel origin isn't in `CORS_ORIGINS`. The request succeeds server-side; the browser is what rejects it. |
| Deep link 404s on the deployed frontend, but works locally | The SPA rewrite in `frontend/vercel.json` isn't being applied — check that Vercel's **Root Directory** is set to `frontend`. |
| TypeScript errors on API shapes after a contract change | Re-run `npm run gen:types`. |

## Documentation

- [docs/backend/architecture.md](docs/backend/architecture.md) — **the backend design doc.** Read
  it before backend work; §16.4 collects the fourteen rules that are easy to get wrong and
  expensive to get wrong.
- [docs/backend/api.md](docs/backend/api.md) and [docs/backend/database.md](docs/backend/database.md) — reference notes on the contract and schema.
- [docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD](docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD) — how clustering interacts with the state machine.
- [backend/migrations/README.md](backend/migrations/README.md) — the two hand-checks on the first migration.
- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, commit format, PR rules.

> ⚠ **Some docs predate the implementation.** [docs/start_here.md](docs/start_here.md) and
> [backend/README.md](backend/README.md) describe the project as scaffold-only, with a
> `controllers/views/middlewares` layout and contract version 2.0.0. That is no longer true —
> trust the code and the contract over them. `backend/README.md`'s *rules* and
> *frontend-mock-as-executable-spec* sections are still accurate; its status claims are not.

## Contributing

Two long-lived branches, **both protected**:

- **`development`** — the integration branch. Cut every feature branch from here, and PR back
  into here.
- **`main`** — the release branch. It only receives merges from `development`.

Never commit directly to either, and never open a feature PR against `main`.

- Branches: `<type>/<short-description>` — `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), e.g.
  `feat(complaints): add evidence re-submission`. Summary ≤72 chars, lowercase, no trailing period.
- Update your branch with **rebase**, not merge, then force-push with `--force-with-lease`.
- One concern per PR; keep backend and frontend changes in separate PRs unless tightly coupled.
- Don't merge your own PR — at least one other team member must approve.
- Never commit `.env` or `*.sqlite3`. Both are already git-ignored.

The full rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
