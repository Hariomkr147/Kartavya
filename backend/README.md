# Kartavya Backend

Flask + SQLAlchemy + SQLite. **Scaffolded, not implemented.** The skeleton, the
pure business rules and the full ORM are in place; the services and endpoints
are stubs waiting for you.

> **Read `docs/backend/architecture.md` before writing code.** This file tells
> you how to run things. That one tells you why the layout is what it is, and
> collects the fourteen rules that are easy to get wrong and expensive to get
> wrong. `backend/api/openapi.yaml` and `backend/database/schema.dbml` outrank
> both of them.

---

## Getting started

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env             # dev defaults work as-is

alembic revision --autogenerate -m "initial schema"
alembic upgrade head             # see migrations/README.md — two things to check by hand
flask --app app seed --demo      # mandatory reference data + 3 example zones

flask --app app run              # http://localhost:5000
curl localhost:5000/health
```

Then:

```bash
pytest                                   # the suite
pytest tests/domain                      # the fast half — no database, milliseconds
lint-imports --config .importlinter      # the layering rules, enforced
ruff check . && ruff format .
```

### Running the real frontend against it

```bash
# frontend/.env.local
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

The frontend is **already finished**. Its ~52 hooks each exercise a real
endpoint, so "the whole app works with mocks off" is the milestone gate worth
aiming at — it proves the contract in a way unit tests cannot.

---

## What is already written, and what is not

| Package | State |
|---|---|
| `app/domain/` | **Implemented.** Every pure rule: the state machine, SLA arithmetic, severity, points, badges, geo. Ported from the frontend mock. 103 tests, all passing. |
| `app/models/` | **Implemented.** All 14 tables, mirroring `schema.dbml` — including the partial catch-all index and the SQLite PRAGMAs. |
| `app/core/` | **Implemented.** JWT auth, zone scoping, the error envelope, request validation, photo-URL signing, the transaction helper. |
| `app/settings.py`, `app/extensions.py`, `app/__init__.py` | **Implemented.** Config with fail-fast secret checks, the app factory, `/health`. |
| `app/seed.py` | **Implemented.** The 12 categories, 6 badges, catch-all zone, settings row, admin. Idempotent. |
| `app/infra/ai/` | **Mostly implemented.** The protocol, the circuit breaker, stub and null providers. `local.py` is a stub. |
| `app/api/` | **Route map only.** All 45 paths are registered with the right methods, decorators and docstrings; every handler raises `501 NOT_IMPLEMENTED`. |
| `app/services/` | **Stubs.** Signatures and step-by-step docstrings. The one exception is `lifecycle.apply_transition()` and the cluster reward test-and-set, which are written out because they are the two places a race would corrupt data. |
| `app/jobs/` | **Stubs**, with a working scheduler. |

Track progress with:

```bash
grep -rn "todo(" app/api/          # endpoints still returning 501
grep -rn "NotImplementedError" app/  # services still to write
```

---

## The five rules most likely to bite you

The full list of fourteen is in `docs/backend/architecture.md` §16.4. These five
are the ones that cause silent data corruption rather than a visible error:

1. **Every status write goes through `services/complaints/lifecycle.py`.**
   Nothing else may assign `complaint.status`. The history row is written inside
   that module, which is what makes an unaudited status change impossible.
2. **Guard every transition with `UPDATE ... WHERE status = <expected>`.**
   `rowcount` is the decision, not a preceding `if`. Two officers *will* claim
   the same complaint at the same moment.
3. **The cluster's +50 is an atomic test-and-set on `reward_granted`,** in the
   same transaction as the close. A read-then-write pays it twice.
4. **`reporter` is emitted only by `app/api/admin/`.** `full_name` never reaches
   another citizen or an officer. `.importlinter` enforces this.
5. **Re-load the user row on every request.** Never authorize from JWT claims: a
   deactivated user and a reassigned officer must both take effect immediately.

---

## Build order

Each phase leaves the app runnable and unblocks a slice of the finished
frontend. Phases 3 and 4 carry the real risk; everything after is comparatively
mechanical.

| Phase | Delivers | Unblocks |
|---|---|---|
| 1. Skeleton | ✅ done — factory, config, models, seed, error envelope, health | everything |
| 2. Auth + reference | register/login/JWT, `/users/me*`, `/categories`, `/zones`, `/zones/suggest` | login, registration, form prefill |
| 3. Complaint core | create (multipart + storage), `/complaints/my`, detail, the lifecycle service, `status_history` | citizen dashboard |
| 4. Officer flow | queue, claim, evidence review, status, notes — the full FSM including SLA start/pause/resume | officer role end to end |
| 5. Clusters | linking, severity recompute, cascade, batch-status, `/clusters*` | officer cluster pages |
| 6. Gamification | upvote, confirm/dispute, ledger, badge engine, leaderboards | citizen gamification page |
| 7. Admin | users, zones, SLA, settings, override, dispute-review, analytics, CSV | admin role |
| 8. AI + jobs | providers, screening job, zone report, **the auto-close sweeper** | AI-dependent UI, the timeout rule |

⚠ **Do not leave the auto-close sweeper to the end and then forget it.** It is
the one requirement with no frontend reference implementation — a browser cannot
run a scheduler, so the mock simply does not have it and nothing will remind you
it is missing.

---

## Use the frontend mock as an executable specification

`frontend/src/mocks/` implements most of these business rules in TypeScript,
with a test suite. Read it before writing the Python.

| File | What it gives you |
|---|---|
| `mocks/lib/fsm.ts` | the transition map and validation logic |
| `mocks/lib/sla.ts` | exact SLA elapsed/label arithmetic |
| `mocks/lib/severity.ts` | the severity formula and bands |
| `mocks/lib/points.ts` | points amounts and the badge engine |
| `mocks/lib/cluster.ts` | cluster linking, centroid recompute, the cascade |
| `mocks/lib/geo.ts` | haversine and nearest-zone matching |
| `mocks/handlers/*.ts` | endpoint-by-endpoint reference behaviour (~2,600 lines) |
| `mocks/integration/lifecycle.test.ts` | 449 lines of end-to-end lifecycle assertions |

`app/domain/` is a direct port of the first six, so they already agree.

**Three places the mock is wrong and the contract wins:**

- `avgResolutionHours` — the mock computes it three different ways
  (`closedAt - createdAt`, `resolvedAt - createdAt`). The contract defines it as
  `resolved_at - sla_started_at - sla_paused_seconds`, everywhere.
- The leaderboard — the mock includes deactivated citizens. The backend must
  filter them out.
- `AuthResponse.expiresAt` — the mock does not emit it. It is required.

---

## Notes on this scaffold

- **`app/api/ai/`** from the architecture doc's tree does **not** exist here.
  Contract 3.0.0 has no `/ai/*` paths: the zone report lives under
  `/admin/zones/{id}/ai-report`, and category suggestion was removed entirely
  (it is now an offline client-side keyword matcher). The AI *adapter* is in
  `app/infra/ai/`, where the doc also puts it.
- **`app/api/shared/responses.py`** is an addition to that tree — it holds the
  `501 NOT_IMPLEMENTED` helper every stub route uses. Delete it once no route
  needs it.
- The **`/health`** endpoint sits outside `/api/v1` deliberately: it is not in
  `openapi.yaml`, and the contract tests validate everything under that prefix.
- **Never commit** `.env` or `*.sqlite3`. Both are already in `.gitignore`.
