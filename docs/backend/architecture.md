# Kartavya — Backend Architecture

> **Status:** proposed design, not yet implemented.
> **Audience:** the backend team. Assumes you know Python and Flask, and assumes you know *nothing* about Kartavya.
> **Authority:** `backend/api/openapi.yaml` and `backend/database/schema.dbml` outrank this document. If they disagree with anything here, they win and this file is wrong — please fix it.

---

## How to read this document

You do not need to read it end to end before writing code.

| If you are… | Read |
|---|---|
| Brand new to the project | Part 1 → Part 2 → Part 4 (~20 minutes) |
| About to write your first endpoint | Part 3, Part 4, Part 7, Part 8 |
| Implementing anything that changes a complaint's status | **Part 5 and Part 6.3. Do not skip these.** |
| Setting up the project skeleton | Part 3, Part 9, Part 13 |
| Wondering "where does this file go?" | Part 3 |
| Wondering "why is it built this way?" | Part 2 |
| Looking for a rule you half-remember | Part 16 (cheat sheets) |

Throughout, this symbol — ⚠️ — marks a rule that is easy to get wrong and expensive to get wrong. There are fourteen of them, collected in §16.4.

---

## Part 1 — What Kartavya is

Kartavya is a **civic grievance platform**. Citizens photograph problems in their neighbourhood (potholes, broken streetlights, overflowing bins), officers fix them, admins run the system. Citizens earn points and badges for participating, which is the "gamified" part.

### The three roles

Everything in the system is shaped by the fact that these three roles see almost entirely different applications:

| Role | Can do | Can never see |
|---|---|---|
| **Citizen** | File complaints, track their own, upvote others', confirm or dispute a fix, earn points/badges | Anyone else's identity; any zone but their own; anything admin |
| **Officer** | Work exactly **one** assigned zone: review photos, move complaints through the lifecycle, post progress notes | **Who filed a complaint** (stripped by the API); any other zone; any admin data |
| **Admin** | Everything, across all zones: manage users/zones/SLAs, analytics, CSV export, rule on disputes, trigger AI reports | — (admins are invisible to the other two roles) |

Officers are **created by admins**, never self-registered. Admins are **seeded directly into the database**, and there is deliberately no API to create one.

### The life of a complaint, in plain English

1. A citizen picks a category, uploads 1–3 photos, confirms which zone it's in, and submits. Status: `SUBMITTED`.
2. An officer in that zone **claims** it. Status: `EVIDENCE_UNDER_REVIEW`. Nobody else can claim it now.
3. The officer looks at the photo and gives a verdict:
   - **Valid** → `UNDER_REVIEW`. **The SLA countdown clock starts here**, not at submission.
   - **Needs more evidence** → `NEEDS_MORE_EVIDENCE`. Citizen uploads a better photo, it goes back to step 3.
   - **Rejected** (fake/invalid) → `REJECTED`, terminal, and the citizen loses 20 points.
4. Officer works it: `IN_PROGRESS` → `UNDER_RESOLUTION` → `RESOLVED`.
5. **`RESOLVED` does not mean finished.** The citizen must now either:
   - **Confirm** → `CLOSED`, and points are credited. Or
   - **Dispute** (requires a reason *and* a fresh photo) → `REOPENED`, and an **admin** — not the officer — rules on it.
   - Or do nothing, in which case the system auto-closes it after a configurable timeout (default 168 hours) **with zero points**.

Two extra mechanics sit on top:

- **Clusters.** If several people report the same pothole, the complaints are grouped into a *cluster*. Severity rises with the number of **distinct** citizens reporting it. When the officer fixes the shared problem, the fix **cascades** to the other members automatically.
- **Points (CSP).** Confirming a fix earns +50 (or +10 if someone in your cluster already claimed the +50). There are bonuses, a penalty, and six badges.

### Scale of the job

| | |
|---|---|
| API operations to implement | **52**, across **45** paths |
| Response/request schemas defined | **67** |
| Database tables | **14** |
| Database enums | **11** |
| Complaint statuses | **11**, with a strictly enforced transition map |

### The one thing that will save you the most time

The frontend is **already built and finished**. It runs today against a mock API written in TypeScript that implements most of these business rules — including a full test suite.

> `frontend/src/mocks/` is, in practice, an executable specification of this backend.

Specifically:

| File | What it gives you |
|---|---|
| `frontend/src/mocks/lib/fsm.ts` | The complete transition map and validation logic |
| `frontend/src/mocks/lib/sla.ts` | Exact SLA elapsed/label arithmetic |
| `frontend/src/mocks/lib/severity.ts` | Severity formula and bands |
| `frontend/src/mocks/lib/points.ts` | Points amounts + the data-driven badge engine |
| `frontend/src/mocks/lib/cluster.ts` | Cluster linking, centroid recompute, the cascade |
| `frontend/src/mocks/lib/geo.ts` | Haversine + nearest-zone matching |
| `frontend/src/mocks/handlers/*.ts` | Endpoint-by-endpoint reference behaviour (~2,600 lines) |
| `frontend/src/mocks/integration/lifecycle.test.ts` | 449 lines of end-to-end lifecycle assertions |

**Read the TypeScript before writing the Python.** It is short, it is commented, and it has already resolved dozens of ambiguities you would otherwise hit one at a time. Porting `lifecycle.test.ts` to pytest *before* implementing the lifecycle is the single highest-value hour available to this team.

---

## Part 2 — The five constraints that determine the design

The architecture in this document is not a matter of taste. Five properties of the contract force it. Understand these five and the rest of the document becomes obvious.

### 2.1 The lifecycle has eight separate "doors"

A complaint's status can be changed by eight different endpoints plus two automated processes — and each one is allowed to produce a *different subset* of statuses:

| # | Door | Who | Statuses it may produce |
|---|---|---|---|
| 1 | `POST /officer/complaints/{id}/claim` | Officer | `EVIDENCE_UNDER_REVIEW` |
| 2 | `POST /officer/complaints/{id}/evidence-review` | Officer | `UNDER_REVIEW`, `NEEDS_MORE_EVIDENCE`, `REJECTED` |
| 3 | `PATCH /officer/complaints/{id}/status` | Officer | `IN_PROGRESS`, `UNDER_RESOLUTION`, `RESOLVED`, `UNRESOLVABLE`, `NEEDS_MORE_EVIDENCE` |
| 4 | `POST /officer/complaints/batch-status` | Officer | same five as #3, applied to many complaints |
| 5 | `POST /complaints/{id}/confirm` | Citizen | `CLOSED` |
| 6 | `POST /complaints/{id}/dispute` | Citizen | `REOPENED` |
| 7 | `POST /admin/complaints/{id}/dispute-review` | Admin | `IN_PROGRESS` or `CLOSED` — **the only exit from `REOPENED`** |
| 8 | `PATCH /admin/complaints/{id}` | Admin | any status (override), with SLA backfill |
| 9 | *cluster cascade* | SYSTEM | `RESOLVED` for eligible siblings |
| 10 | *auto-close sweeper* | SYSTEM | `CLOSED`, no points |

**Consequence:** the transition rules cannot live in the endpoints. They live in **one module** that all ten call. Ten copies of "is this transition legal?" would drift apart within a fortnight, and the resulting bug — an illegal status jump — is silent and corrupts audit history permanently.

### 2.2 Nothing derivable may be stored

The schema calls this out explicitly and repeatedly. These values are **computed every time they are read**:

| Value | Computed from |
|---|---|
| `severityLabel` | `complaints.severity_score` |
| `slaLabel` | `sla_target_hours`, `sla_started_at`, `sla_paused_seconds`, `sla_paused_at`, and *now* |
| Lifetime / monthly points | `SUM(points_ledger.points_change)` |
| `upvoteCount` | `COUNT(*)` on `complaint_upvotes` |
| Cluster `statusSummary` | the current statuses of its member complaints |

The reasoning: a stored copy can silently disagree with its source. A derived value cannot.

**Consequence:** computation belongs in the **serialization layer**, not in the models and not in columns. There is exactly one permitted exception — `complaints.severity_score` is a cached column (so the database can sort and filter by it), but even then the **label** is always derived from it at read time.

### 2.3 Three tables are append-only

`status_history`, `points_ledger`, and `complaint_evidence` are audit trails. You **INSERT** into them. You never `UPDATE` and never `DELETE`.

- Every status change is one new `status_history` row, forever.
- Every points change is one new `points_ledger` row; the citizen's total is the sum. There is no "total points" column anywhere, deliberately.
- Every re-uploaded photo is a new `complaint_evidence` row with the next `sequence`; the old photo stays.

**Consequence:** these three tables get service helpers that only insert. No update code path for them should exist in the codebase at all — so a careless `UPDATE` has nothing to copy from.

### 2.4 The privacy walls are the highest-risk part of the system

- ⚠️ **A complaint's reporter is never visible to an officer.** Not their name, not their ID, not indirectly.
- ⚠️ **`users.full_name` is never shown to another citizen or to an officer.** Public surfaces use `display_name`, with a masked fallback like `Citizen #1042`.
- ⚠️ **Officers are identified to citizens by ID only**, never by name.
- ⚠️ **An officer sees exactly one zone.** Not "usually one zone" — one, always, on every endpoint.

These are not features that can be added later. A leak here is the kind of bug that gets noticed by the wrong person.

**Consequence:** serialization is split **by audience**, so "what can an officer see?" is answered by opening one folder — and `reporter` appearing outside the admin folder is visibly wrong in code review.

### 2.5 AI must never be able to break the app

Two features use a local AI model: photo pre-screening and zone health reports. Both are **advisory**. The contract requires that when the model is down, the app keeps working and the affected fields simply report `UNAVAILABLE` / `aiAvailable: false`. (Category suggestion used to be a third; it is now a client-side keyword matcher with no server involvement — see Part 11.)

**Consequence:** all AI access goes through one adapter that *cannot* raise. Its failure mode is returning `None`. Two of the three features are also asynchronous, which means the app needs background workers.

---

## Part 3 — The map: folder structure

### 3.1 The organising idea, in one sentence

> **Business logic is grouped by what it changes (aggregate). Serialization is grouped by who is looking (audience).**

Business rules do not care who is calling — a status transition is legal or illegal regardless of role. Serialization cares about *nothing else* — the same complaint row becomes three different JSON documents depending on whether a citizen, officer or admin asked for it, and those differences **are** the privacy policy from §2.4.

Splitting the codebase along those two different axes is the central decision here.

### 3.2 The tree

```text
backend/
├── app/
│   ├── __init__.py            create_app(): config, extensions, blueprints, error handlers
│   ├── settings.py            environment-driven config classes
│   ├── extensions.py          db, scheduler, and other singletons
│   │
│   ├── domain/                ★ PURE RULES — no SQLAlchemy, no Flask, no clock, no I/O
│   │   ├── enums.py           the 11 enums, mirroring schema.dbml exactly
│   │   ├── lifecycle.py       transition map, per-door permissions, reason rules, cascade eligibility
│   │   ├── sla.py             elapsed / label / pause / resume arithmetic
│   │   ├── severity.py        score formulas and label bands
│   │   ├── points.py          which reason(s) a given event earns
│   │   ├── badges.py          data-driven criteria evaluation
│   │   ├── geo.py             haversine distance, nearest-active-centroid matching
│   │   └── errors.py          ValidationError / ForbiddenError / NotFoundError / ConflictError
│   │
│   ├── models/                SQLAlchemy ORM — the whole schema, as one shared package
│   │   ├── base.py            declarative base, mixins, engine PRAGMA hooks
│   │   ├── accounts.py        users, zones, complaint_categories
│   │   ├── complaints.py      complaints, complaint_clusters, complaint_evidence
│   │   ├── history.py         status_history, complaint_notes, complaint_upvotes
│   │   ├── gamification.py    points_ledger, badges, citizen_badges
│   │   └── system.py          ai_zone_reports, app_settings
│   │
│   ├── services/              WRITE SIDE — business operations, grouped by aggregate
│   │   ├── complaints/
│   │   │   ├── lifecycle.py   ★ THE single choke point for every status write + history row
│   │   │   ├── submission.py  create complaint, re-submit evidence, file a dispute
│   │   │   ├── evidence.py    photo upload sequencing, verdict recording
│   │   │   ├── clusters.py    linking, centroid/count recompute, cascade, reward test-and-set
│   │   │   └── upvotes.py
│   │   ├── accounts/          auth.py, users.py, zones.py, settings.py
│   │   ├── gamification/      ledger.py, badges.py, leaderboard.py
│   │   ├── analytics/         zone.py, system.py, officer.py, export.py
│   │   └── queries.py         shared filter / sort / paginate / zone-scope query builders
│   │
│   ├── api/                   READ SIDE + HTTP surface — grouped by audience
│   │   ├── shared/
│   │   │   ├── serializers.py neutral shapes: compact Complaint, Category, Zone, Evidence, …
│   │   │   ├── pagination.py  the PaginationMeta envelope
│   │   │   └── routes.py      /clusters, /clusters/{id}, /zones/{id}/summary  (officer + admin)
│   │   ├── auth/              routes.py, schemas.py         — public: register, login
│   │   ├── reference/         routes.py                     — public: categories, zones, zone suggest
│   │   ├── account/           routes.py, schemas.py         — any role: /users/me*
│   │   ├── citizen/           routes.py, schemas.py, serializers.py
│   │   ├── officer/           routes.py, schemas.py, serializers.py   ← reporter is ABSENT here
│   │   ├── admin/             routes.py, schemas.py, serializers.py   ← the ONLY place reporter appears
│   │   └── ai/                routes.py, schemas.py
│   │
│   ├── core/                  cross-cutting HTTP plumbing
│   │   ├── auth.py            JWT issue/verify, current_user, @require_auth / @require_role
│   │   ├── scoping.py         visible_complaints(user) and friends
│   │   ├── errors.py          domain error → {"error":{...}} envelope; Flask error handlers
│   │   ├── validation.py      Pydantic request-model plumbing
│   │   ├── signing.py         mints + verifies the signed photo URLs (Part 12)
│   │   └── session.py         transaction helper / commit boundary
│   │
│   ├── infra/                 the outside world — all swappable
│   │   ├── storage.py         photo validation + filesystem writes
│   │   └── ai/                provider protocol, local.py, keyword.py, null.py, breaker.py
│   │
│   ├── jobs/                  screening.py, zone_report.py, auto_close.py, scheduler.py
│   └── seed.py                the mandatory seed data (see §9.4)
│
├── migrations/                Alembic
└── tests/
    ├── domain/                fast, no database — the bulk of the tests live here
    ├── services/              in-memory SQLite + factories
    ├── api/                   Flask test client, including privacy assertions
    └── contract/              response validation against openapi.yaml
```

### 3.3 ⚠️ The dependency rule

Imports flow in **one direction only**:

```text
        api  ──────▶  services  ──────▶  models
         │               │                 │
         └───────────────┴─────────────────┴──────▶  domain
                                                      (imports NOTHING)

        core  ──▶ Flask only          infra  ──▶ outside world only
```

Read as four rules:

1. **`domain/` imports nothing from the rest of the app.** No SQLAlchemy, no Flask, no `datetime.now()` — time is always passed in as an argument. This is what makes the hardest logic in the system testable in milliseconds, forever.
2. **`api/` never touches `db.session`.** If a route function imports a model, that is a code smell. Routes parse input, call one service, hand the result to a serializer.
3. **Serializers never query.** They receive everything pre-loaded. This keeps privacy decisions visible in one place and prevents N+1 query storms.
4. **`services/` is the only layer that opens transactions.**

Enforce rule 1 mechanically, not by discipline — [import-linter](https://import-linter.readthedocs.io/) does it in CI with a short config:

```ini
# .importlinter
[importlinter]
root_package = app

[importlinter:contract:layers]
name = Layered architecture
type = layers
layers =
    app.api
    app.services
    app.models
    app.domain

[importlinter:contract:pure-domain]
name = Domain is pure
type = forbidden
source_modules = app.domain
forbidden_modules = flask, sqlalchemy, app.models, app.services, app.api
```

Without this guard, `app/domain/` slowly acquires a `db.session` and becomes untestable by week four. With it, that is a failing build.

### 3.4 Why models are *not* split per feature

`models/` is the one package not sliced vertically. That is deliberate.

The 14 tables form one tightly connected foreign-key graph (`users ↔ zones ↔ complaints ↔ clusters ↔ evidence ↔ ledger ↔ badges`). Splitting them across feature folders buys nothing and costs circular imports and SQLAlchemy registry-ordering bugs. The schema is a fixed, contract-owned artefact — treat it as a **shared kernel** and move on.

### 3.5 Naming notes

If you have seen the older layout in `CONTRIBUTING.md` (`controllers/`, `views/`, `middlewares/`), it has been replaced by this one. Briefly, why:

- **`views/`** collides with Flask's own vocabulary — in Flask, a "view function" is the request handler, not a serializer. Guaranteed confusion.
- **`middlewares/`** describes something Flask does not have. What lives there is decorators and error handlers → now `core/`.
- **Layer-only slicing** meant a one-line feature touched five folders, and every teammate edited the same five files. That is a merge-conflict generator on a team this size.

---

## Part 4 — One request, end to end

Concrete beats abstract. Here is **`PATCH /officer/complaints/42/status`** with `{"status": "RESOLVED", "note": "Filled and compacted."}` — the most involved ordinary request in the system — traced through every layer.

```text
 1. Flask routes the URL
    app/api/officer/routes.py  →  update_complaint_status(complaint_id)

 2. @require_role("OFFICER")                                    [core/auth.py]
    • Reads the Authorization: Bearer <jwt> header
    • Verifies the signature and expiry
    • ⚠️ RE-LOADS the user row from the database (see §7.2 for why)
    • Rejects if is_active is False  → 401
    • Rejects if role != OFFICER     → 403

 3. Request body validation                                     [core/validation.py]
    StatusUpdateRequest (Pydantic): status ∈ OfficerTargetStatus, optional reason/note
    • Anything else → 400 VALIDATION_ERROR, with per-field details

 4. Route calls exactly one service function
    lifecycle.transition_by_officer(
        complaint_id=42, officer=current_user,
        target="RESOLVED", reason=None, note="Filled and compacted.")

 5. Inside the service — ONE transaction opens here    [services/complaints/lifecycle.py]

    a. Load the complaint through the zone-scoped query       [services/queries.py]
       → not found, or not in this officer's zone → 404 / 403

    b. Ask the pure rules whether this is legal                [domain/lifecycle.py]
       validate_officer_transition(current="UNDER_RESOLUTION",
                                   target="RESOLVED", reason=None)
       → illegal → 409 INVALID_TRANSITION
       → reason required but missing → 400 REASON_REQUIRED

    c. Apply the status change as a GUARDED UPDATE              (§6.3 — critical)
       UPDATE complaints SET status='RESOLVED', resolved_at=now, updated_at=now
        WHERE id=42 AND status='UNDER_RESOLUTION'
       rowcount == 0 → someone else moved it first → 409

    d. INSERT the audit row                                     [append-only]
       status_history(from='UNDER_RESOLUTION', to='RESOLVED',
                      actor_role='OFFICER', changed_by_user_id=<officer>,
                      remark='Filled and compacted.')

    e. Because the target is RESOLVED and the complaint is clustered:
       cascade_cluster_resolution()                     [services/complaints/clusters.py]
       For every OTHER member of the cluster:
         • UNDER_REVIEW / IN_PROGRESS / UNDER_RESOLUTION → set RESOLVED,
           plus its own status_history row with actor_role='SYSTEM'  → "CASCADED"
         • anything else (terminal, already RESOLVED, still in the
           evidence phase, or REOPENED) → leave alone               → "SKIPPED"
       Returns the per-member outcome list.

    f. db.session.commit()   ← the single commit for the whole request

 6. Serialize for this audience                    [api/officer/serializers.py]
    StatusUpdateResult = { complaint: <ComplaintDetail>, cascade: [...] }
    • severityLabel derived from severity_score       [domain/severity.py]
    • slaLabel derived from the four sla_* columns    [domain/sla.py]
    • upvoteCount from a pre-loaded COUNT
    • ⚠️ reporter is not in the officer serializer at all

 7. Any exception raised anywhere above is caught by the global
    handler and rendered as {"error":{"code","message","details"}}  [core/errors.py]
```

Note what each layer did **not** do. The route did no logic. The service did no HTTP. The rules did no I/O. The serializer did no querying. That separation is the whole point, and it is what makes each piece testable alone.

---

## Part 5 — The domain core (`app/domain/`)

This is the most important package in the codebase. It holds every rule that is hard to get right, expressed as **pure functions over plain values** — integers, strings, enums, datetimes. No database, no Flask, no global clock.

Why that matters: these rules need hundreds of tests (every legal transition, every illegal one, every boundary of every band). With pure functions those tests run in milliseconds with no fixtures. The moment a rule needs a database session to run, testing it becomes slow and awkward, and it stops being tested thoroughly.

### 5.1 `domain/lifecycle.py` — the state machine

The 11 statuses:

```text
SUBMITTED → EVIDENCE_UNDER_REVIEW → ┬→ UNDER_REVIEW → IN_PROGRESS → UNDER_RESOLUTION → RESOLVED
                    ↑               ├→ NEEDS_MORE_EVIDENCE ──┘(re-upload)            ├→ CLOSED  (terminal)
                    └───────────────┘                                               └→ REOPENED → ┬→ IN_PROGRESS
                                    └→ REJECTED (terminal, first round only)                      └→ CLOSED
    any active stage → UNRESOLVABLE (terminal)
```

The core tables:

```python
TERMINAL = {REJECTED, CLOSED, UNRESOLVABLE}

# The five targets an officer may request via the status / batch-status doors,
# each mapped to the statuses it is legal to arrive from.
OFFICER_TRANSITIONS = {
    IN_PROGRESS:         {UNDER_REVIEW},
    UNDER_RESOLUTION:    {IN_PROGRESS},
    RESOLVED:            {UNDER_RESOLUTION},
    UNRESOLVABLE:        {UNDER_REVIEW, IN_PROGRESS, UNDER_RESOLUTION},
    NEEDS_MORE_EVIDENCE: {UNDER_REVIEW},     # post-acceptance recall only
}

REASON_REQUIRED = {UNRESOLVABLE, NEEDS_MORE_EVIDENCE}

# Which sibling statuses a cluster resolution may sweep along:
CASCADE_ELIGIBLE = {UNDER_REVIEW, IN_PROGRESS, UNDER_RESOLUTION}
```

Plus one validation function per door, each returning a **result object** (not raising):

```python
validate_officer_transition(current, target, reason)      -> Ok | Err(code, message)
validate_evidence_review(current, sla_started_at, verdict, reason)
validate_dispute_review(current)
validate_confirm(current)
validate_dispute(current)
```

They return rather than raise because `POST /officer/complaints/batch-status` needs a per-item failure code (`INVALID_TRANSITION`, `NOT_IN_ZONE`, `UNKNOWN_COMPLAINT`, `REASON_REQUIRED`) for up to 100 complaints in one response. Exceptions would force one try/except per item and lose the structure.

Three rules in here are subtle enough to state explicitly:

> ⚠️ **1. `REJECTED` is first-round only.** An officer may reject evidence only while `sla_started_at IS NULL` — i.e. the complaint has never been accepted. Once a complaint has reached `UNDER_REVIEW`, an officer can recall it for better evidence, but the re-review may only return `VALID` or `NEEDS_MORE_EVIDENCE`. Requesting `REJECTED` there is a **409**. Rationale from the contract: the complaint was already validated once and may be actively being worked, so declaring it fake now would be a false accusation carrying a real −20 point penalty.

> ⚠️ **2. `REOPENED` has exactly one exit, and it belongs to the admin.** Not the single status endpoint, not the batch endpoint, not the cluster cascade — only `POST /admin/complaints/{id}/dispute-review`. All three of the other paths must actively refuse it. The cascade in particular must skip `REOPENED` members, so a sibling's fix can never sweep a pending dispute aside before the admin has ruled.

> ⚠️ **3. `NEEDS_MORE_EVIDENCE` is reachable two different ways** and they behave differently. From `EVIDENCE_UNDER_REVIEW` (first round, pre-acceptance) the SLA clock has not started, so there is nothing to pause. From `UNDER_REVIEW` (officer recalls an already-accepted complaint) the clock **is** running and must be paused. Same status, two different side effects.

### 5.2 `domain/sla.py` — the clock

Every complaint carries a frozen snapshot of its own SLA target, so later admin edits to a category's SLA cannot retroactively move complaints already in flight.

```python
def elapsed_seconds(started_at, paused_seconds, paused_at, now) -> float:
    """Wall-clock time since the clock started, minus all paused time."""
    total_paused = paused_seconds
    if paused_at:                                  # currently paused
        total_paused += (now - paused_at).total_seconds()
    return (now - started_at).total_seconds() - total_paused


def label(target_hours, started_at, paused_seconds, paused_at, now) -> SlaLabel | None:
    if target_hours is None or started_at is None:
        return None                                # not yet accepted — no clock, no label
    pct = (elapsed_seconds(started_at, paused_seconds, paused_at, now) / 3600
           / target_hours) * 100
    if pct < 80:   return ON_TIME
    if pct < 100:  return DELAYED
    return OVERDUE
```

The four moments the clock is *written* live in `services/complaints/lifecycle.py`, not here:

| Moment | Trigger | Effect |
|---|---|---|
| **Start** | evidence-review verdict `VALID` | Snapshot `sla_target_hours` from the category **as it is right now**; set `sla_started_at = now` |
| **Pause** | entering `NEEDS_MORE_EVIDENCE` | Set `sla_paused_at = now` — ⚠️ **only if `sla_started_at` is already set**; otherwise no-op |
| **Resume** | leaving `NEEDS_MORE_EVIDENCE` back to `EVIDENCE_UNDER_REVIEW` | `sla_paused_seconds += (now − sla_paused_at)`; set `sla_paused_at = NULL` |
| **Backfill** | admin override landing at `UNDER_REVIEW` or later while `sla_started_at IS NULL` | Set both as if `VALID` had fired, so `slaLabel` is never silently null on an overridden complaint |

> ⚠️ **Paused time must never count against the SLA.** A complaint sitting for three days waiting on a citizen's photo has not consumed three days of the officer's target. This is the single most-likely-to-be-wrong calculation in the system; give it thorough boundary tests.

### 5.3 `domain/severity.py` — and the trap in it

```python
def score(unique_reporter_count: int, upvotes: int) -> int:
    return (unique_reporter_count - 1) * 3 + upvotes

def label(score: int) -> SeverityLabel:
    if score >= 30: return CRITICAL
    if score >= 15: return HIGH
    if score >=  5: return MEDIUM
    return LOW
```

> ⚠️ **There are two different severity scores and they are not the same formula.**
>
> | | `unique_reporter_count` | upvotes term |
> |---|---|---|
> | **A complaint's** `severity_score` | from its cluster (or 1 if standalone) | **only its own** upvotes |
> | **A cluster's** `severityScore` (API) | its own count | **total upvotes across all members** |
>
> Both use the same `score()` function with different arguments. Passing the wrong upvote total is an easy and invisible mistake.

Note that severity counts **distinct citizens**, never raw report count. That is a deliberate anti-gaming measure: one person filing the same complaint ten times must not be able to inflate its urgency.

`complaints.severity_score` is the one cached derived column (so SQL can sort/filter by it). **Recompute it** on: complaint creation, cluster join, and every upvote — and when a cluster's membership changes, recompute it for *every* member of that cluster, not just the new one.

### 5.4 `domain/points.py` and `domain/badges.py`

The six point reasons and their fixed amounts:

| Reason | Amount | When |
|---|---|---|
| `COMPLAINT_CLOSED` | **+50** | Citizen confirms a standalone complaint, **or** is the first in their cluster to confirm |
| `CLUSTER_MEMBER_CLOSED` | **+10** | Citizen confirms, but another cluster member already took the +50 |
| `FIRST_COMPLAINT` | **+10** | The citizen's first-ever complaint is filed |
| `ON_TIME_BONUS` | **+15** | On confirm, if *this complaint's own* SLA label is `ON_TIME` |
| `UPVOTE_RECEIVED` | **+5** | Someone upvotes your complaint (credited to the reporter) |
| `REJECTED_PENALTY` | **−20** | Your evidence is rejected as fake/invalid |

The rules that make the cluster reward fair (all from the contract):

- ⚠️ The **+50 is paid once per cluster**, to whoever *confirms* first — not whoever *reported* first.
- ⚠️ It is also paid **at most once per citizen per cluster**. If you filed three complaints that got clustered together, only your first confirm pays. Confirming the other two closes them and credits **nothing**. Otherwise duplicate filing would farm rewards.
- ⚠️ `ON_TIME_BONUS` is completely independent — evaluated per complaint against its own SLA snapshot. A member who only got the +10 can still separately earn +15.
- ⚠️ **Auto-close credits nothing**, and a **dispute rejected by an admin credits nothing** on its way to `CLOSED`. Rewards flow only through an explicit citizen confirm. (Otherwise a citizen could dispute instead of confirming and still get a second shot at the reward they gave up.)

**Badges are data-driven, not hardcoded.** The `badges` table stores `criteria_type`, `criteria_value` and `criteria_count`; the engine evaluates every not-yet-earned badge after any relevant event:

| `criteria_type` | Meaning |
|---|---|
| `FIRST_COMPLAINT` | Awarded when the citizen files their first complaint |
| `COMPLAINTS_CLOSED` | Awarded at `criteria_value` closed complaints |
| `LIFETIME_POINTS` | Awarded at `criteria_value` lifetime CSP |
| `ZONE_RANK_ONE` | Awarded on reaching #1 on their zone's leaderboard |
| `CLOSED_WITHIN_DAYS` | Awarded at `criteria_count` closures within any `criteria_value`-day window |

The `(citizen_id, badge_id)` unique index guarantees a badge is awarded at most once per citizen — but check before inserting so you return a clean result rather than an `IntegrityError`.

### 5.5 `domain/geo.py` — zones and clustering

Zones have **no polygons and no radius**. A zone is just a centre point, and a location belongs to whichever zone's centre is *nearest*. This guarantees every coordinate maps to exactly one zone, with no gaps and no overlaps. Exactly one zone is flagged `is_catch_all` — the "Unassigned" fallback.

Two functions:

- `haversine_meters(lat1, lng1, lat2, lng2)` — great-circle distance.
- `nearest_active_zone(zones, lat, lng)` — ⚠️ **filters out inactive zones first**, so `/zones/suggest` never pre-fills a zone that `POST /complaints` would then reject.

> ⚠️ **The server never routes a complaint by itself.** `CreateComplaintRequest.zoneId` is required and the server trusts it — it only checks the zone exists and is active. The citizen always sees and confirms a zone before submitting (either pre-filled from photo EXIF GPS via `/zones/suggest`, or picked manually). And once stored, a complaint's zone is a **snapshot**: an admin later moving a zone's centre does not retroactively move old complaints.

Clustering uses the same haversine: a new complaint joins an existing cluster if there is one within ~100 m with the **same category and same zone**; failing that, it forms a new cluster with the nearest matching standalone complaint; failing that, it stays standalone. (See `frontend/src/mocks/lib/cluster.ts` for the reference implementation, including the detail that a `REJECTED` complaint is excluded as a cluster seed — a debunked fake report should not anchor a new cluster.)

---

## Part 6 — The write side (`app/services/`)

### 6.1 Structure and the golden rule

Services are grouped by **aggregate** — the thing they change — not by who calls them. `services/complaints/lifecycle.py` is imported by officer routes, admin routes, citizen routes *and* the background jobs. That is intentional and it is the most important line in the whole tree:

> ⚠️ **Every status write in the entire system goes through `services/complaints/lifecycle.py`.**
> No other module may assign to `complaint.status`. Because the history row is written inside that module, a status change without a matching `status_history` entry becomes structurally impossible.

If you find yourself writing `complaint.status = ...` anywhere else, stop — that is the bug this design exists to prevent.

### 6.2 Transactions

- **One `db.session.commit()` per request**, in the service. Routes never commit.
- Anything that must be atomic together lives in one service function: status change + history row + points + badge award is **one transaction**. A crash halfway must leave nothing behind.
- Background jobs open their **own** session and commit it themselves. Never hand a request-scoped session to a thread.

### 6.3 ⚠️ Concurrency: guard transitions with conditional UPDATE

This is the single most important implementation technique in this document. Three places in Kartavya race, and all three are solved the same way.

**The wrong way** (read, decide, write — two officers can both pass the check):

```python
complaint = session.get(Complaint, cid)
if complaint.status != "SUBMITTED":            # ← both threads can be here at once
    raise ConflictError(...)
complaint.status = "EVIDENCE_UNDER_REVIEW"     # ← both write; last one wins silently
complaint.assigned_officer_id = officer.id
```

**The right way** — put the expected state in the `WHERE` clause and let the row count decide:

```python
rows = session.execute(
    update(Complaint)
    .where(Complaint.id == cid, Complaint.status == "SUBMITTED")     # ← the guard
    .values(status="EVIDENCE_UNDER_REVIEW", assigned_officer_id=officer.id)
).rowcount

if rows == 0:
    raise ConflictError("INVALID_TRANSITION",
                        "Another officer has already claimed this complaint.")
```

`rowcount` **is** the decision. Exactly one of two concurrent claimers gets `1`; the other gets `0` and a clean 409 — which is precisely what the contract specifies for this endpoint.

The same pattern covers all three races:

| Race | Guard |
|---|---|
| Two officers claim the same `SUBMITTED` complaint | `WHERE status = 'SUBMITTED'` |
| A citizen double-submits confirm or dispute (double-click, retry) | `WHERE status = 'RESOLVED'` |
| Two cluster members confirm simultaneously — who gets the +50? | see below |

The cluster reward is the highest-stakes one, because getting it wrong pays +50 twice:

```python
won = session.execute(
    update(Cluster)
    .where(Cluster.id == cluster_id, Cluster.reward_granted.is_(False))
    .values(reward_granted=True)
).rowcount == 1

award(COMPLAINT_CLOSED if won else CLUSTER_MEMBER_CLOSED)      # +50 : +10
```

The atomic test-and-set *is* the decision about who won. It must happen in the same transaction as the `CLOSED` write.

### 6.4 The batch endpoint's unusual semantics

`POST /officer/complaints/batch-status` is the only endpoint where a partial failure is a **success response**. The contract requires that it be processed in a single transaction *and* report success/failure per complaint.

Resolve that as: **validate all → apply the valid ones → one commit.**

- Per-item failures are collected as `TransitionFailureCode` values in the 200 response. They are **not** rollbacks.
- An unknown complaint ID is a per-item `UNKNOWN_COMPLAINT`, **not** a 404. (An unknown `clusterId` *is* a 404 — that difference is deliberate.)
- Wrap each item in `session.begin_nested()` (a SAVEPOINT) if you want one item's database error contained rather than poisoning the batch.
- Exactly one of `complaintIds` or `clusterId` must be supplied — both or neither is a 400, enforced by the schema's `oneOf`.

### 6.5 Pre-check the RESTRICT deletes

The schema uses `ON DELETE RESTRICT` to protect audit trails. So `DELETE /admin/users/{id}` and `DELETE /admin/zones/{id}` will hit an `IntegrityError` if you just try the delete — which would surface as a 500. The contract wants a **409 with a helpful message**.

Count the blocking references explicitly first:

- **User:** complaints filed, points ledger rows, progress notes authored, evidence reviews performed, status history entries.
- **Zone:** complaints, assigned officers, **citizens whose home zone this is** (easy to forget — registration requires a home zone, so any zone real users signed up against is blocked), and `is_catch_all` (never deletable).

Both endpoints exist mainly to clean up mistakes. The documented, recommended path is always **deactivate**, not delete.

---

## Part 7 — The read side (`app/api/`)

### 7.1 Split by audience, because privacy is the risk

Each audience package owns its own serializers. The neutral shapes live in `api/shared/serializers.py`; audience packages add only their deltas:

| Package | Adds |
|---|---|
| `api/shared/` | compact `Complaint`, `Category`, `Zone`, `Evidence`, `StatusHistoryEntry`, `ProgressNote` — none of which contain reporter identity at all |
| `api/citizen/` | `citizenActionNeeded` (`CONFIRM_FIX` / `PROVIDE_MORE_EVIDENCE`), owner-only |
| `api/officer/` | queue ordering, the `cascade` array — **and nothing identity-related** |
| `api/admin/` | ⚠️ `reporter` — the only place in the codebase this field is ever emitted |

Three invariants worth asserting in tests, not just reviewing by eye:

1. The compact `Complaint` shape has **no reporter field at all** — structurally, not by stripping. Officer queues, the public feed and cluster details all reuse it, so there is nothing to accidentally leak.
2. `full_name` appears only in `GET /users/me` (self) and admin views. Leaderboards use `display_name`, with a server-generated masked fallback.
3. Officers are referenced by ID everywhere — `assignedOfficerId`, `changedByOfficerId`, `ProgressNote.officerId` — and `GET /officers/{id}/stats` exposes only a resolved count.

A cheap, high-value test: for every officer-visible endpoint, assert `"reporter" not in response_json`.

### 7.2 Authentication

`POST /auth/login` issues an HS256 JWT containing `sub` (user id), `role`, `zone_id`, `iat`, `exp`.

> ⚠️ **Treat JWT claims as a routing hint, never as authorization.** Re-load the user row from the database on every request and re-check `is_active` and `zone_id`.
>
> Why: the contract says deactivating a user and reassigning an officer's zone both take effect **immediately**. A token issued five minutes ago still carries the old zone. If you authorize from the token, a reassigned officer keeps access to their old zone until their token expires — a real, silent privacy breach.

Exactly five operations are public (`security: []`): register, login, `GET /categories`, `GET /zones`, and `GET /evidence/{evidenceId}/photo` — the last one authorized by its URL signature instead of a header (Part 12), not by being genuinely open. Read the list carefully: `POST /zones/suggest` is **not** public, it requires a token. Everything else requires a bearer token.

### 7.3 Zone scoping is a query concern

Do not fetch rows and filter them afterwards. Start every complaint query from one helper:

```python
def visible_complaints(user):
    q = select(Complaint)
    if user.role == CITIZEN:
        return q.where(Complaint.citizen_id == user.id)
    if user.role == OFFICER:
        return q.where(Complaint.zone_id == user.zone_id)
    return q                                       # ADMIN sees everything
```

Now an officer's zone restriction is structurally hard to forget: a missing `.where()` would have to be a deliberate deletion rather than an omission. The same idea applies to clusters, analytics and the feed.

### 7.4 Serialization performance

Serializers must not query — so the service passes a small prefetch context:

- category and zone lookup maps (they are tiny and fixed; cache them per request),
- `upvote_count` per complaint from **one** `GROUP BY`,
- the first evidence row per complaint for `photoUrl`.

This matters most on `GET /officer/complaints` and `GET /feed`, which serialize a full page every call. Without it, a 20-item page becomes 60+ queries.

The serializer is also where `photoUrl` is **signed** — `sign_photo_url(evidence.id)` from `core/signing.py`, never the raw `file_path`. That placement is the point: by the time a serializer runs, §7.3's scoping has already decided this caller may see this complaint, and the signature is just that decision made portable to an `<img>` tag. See Part 12.

### 7.5 Shared query concerns

`services/queries.py` owns the four things nearly every list endpoint needs, so they behave identically everywhere:

- **Pagination** — `page` (1-based, default 1) and `pageSize` (default 20, max 100), always returned wrapped in `PaginationMeta{page, pageSize, totalItems, totalPages}`.
- **Sorting** — a field name, `-` prefix for descending. Supported: `createdAt`, `updatedAt`, `severity`, `sla`, `upvotes`. An unrecognised value falls back to the endpoint's documented default rather than erroring.
- **Filtering** — `status` (repeatable), `categoryId`, `zoneId`, `slaLabel`, `severityLabel`, `dateFrom`, `dateTo`.
- **Zone scoping** — §7.3.

Note that `slaLabel` and `severityLabel` are *derived*, so filtering by them cannot be a plain `WHERE` on a column. `severityLabel` maps to a range check on the cached `severity_score`; `slaLabel` needs the elapsed-time expression computed in SQL, or a post-filter on the page — decide once, in this module, and document which.

---

## Part 8 — Errors

One consistent envelope for every non-2xx response, defined in the contract and already relied on by the frontend (`frontend/src/services/http.ts` reads `error.code` and `error.details` off every failure):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A reason is required when rejecting a complaint.",
    "details": [{ "field": "reason", "issue": "must not be empty" }]
  }
}
```

`core/errors.py` registers one handler per domain exception:

| Exception | HTTP | `code` |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `AuthError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError(code)` | 409 | carries its own, e.g. `INVALID_TRANSITION`, `EMAIL_TAKEN`, `ALREADY_UPVOTED` |
| anything else | 500 | `INTERNAL_ERROR` — ⚠️ log the detail, never return it |

Raise these from services. Routes should contain no try/except at all.

---

## Part 9 — Persistence

### 9.1 Models mirror the schema exactly

`schema.dbml` is authoritative — column names, types, nullability, indexes and delete rules. Do not improve on it in the models. Enums become `Enum(PyEnum, native_enum=False)`, which renders as a `CHECK` constraint on SQLite, exactly as the schema's design note intends.

### 9.2 ⚠️ Two pieces of DDL that need hand-writing

**The catch-all zone constraint must be a PARTIAL index.** A plain `unique=True` on `is_catch_all` would also cap the table at one `is_catch_all = false` row — blocking every real zone after the first. The schema calls this out specifically:

```python
Index("ux_zones_catch_all", Zone.is_catch_all,
      unique=True, sqlite_where=Zone.is_catch_all.is_(True))
```

**SQLite disables foreign keys by default.** If you do not turn them on, every `RESTRICT` and `CASCADE` rule in the schema is silently inert:

```python
@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")     # ← without this, the FK rules do NOTHING
    cur.execute("PRAGMA journal_mode=WAL")    # readers don't block on a writer
    cur.execute("PRAGMA busy_timeout=5000")   # wait for a lock instead of failing instantly
    cur.close()
```

### 9.3 Migrations

Use **Alembic from the first commit**, even though the schema is already final. SQLite's `ALTER TABLE` support is very limited, and you will need at least the partial index and the enum CHECK constraints expressed as real migrations. `create_all()` is fine for tests; it is not fine for the shared dev database.

### 9.4 Seed data (mandatory — the app does not work without it)

Make this a single idempotent `flask seed` command:

- the **12 complaint categories**, each with its default `sla_hours`,
- the **6 badges**, with `criteria_type` / `criteria_value` / `criteria_count`,
- **exactly one** zone with `is_catch_all = true` (the "Unassigned" fallback — never deletable),
- the single `app_settings` row (`id = 1`, `auto_close_timeout_hours = 168`),
- at least one **admin** user. ⚠️ Admins are seeded only. There is deliberately no API that creates one.

---

## Part 10 — Background jobs (`app/jobs/`)

Three things happen outside the request cycle. One APScheduler instance, started in `create_app()` — guard against the Flask dev reloader starting it twice.

| Job | Trigger | Behaviour |
|---|---|---|
| **AI photo pre-screening** | fire-and-forget, per evidence row, on create / re-submit / dispute | `PENDING` → `DONE` (writes `ai_matches_category`, `ai_confidence`, `ai_note`) or `UNAVAILABLE`. ⚠️ Must never block the 201 response. A 3-photo complaint spawns 3 independent jobs. |
| **AI zone report** | fire-and-forget on `POST /admin/zones/{id}/ai-report`, which returns **202** + `PENDING` at once | `PENDING` → `READY`, or `FAILED` with `aiAvailable: false`. The matching `GET` is a poll. |
| **Auto-close sweeper** | interval, every ~15 minutes | `RESOLVED` complaints older than `auto_close_timeout_hours` → `CLOSED`, `actor_role = SYSTEM`, `changed_by_user_id = NULL`, **zero points**. |

> ⚠️ **The auto-close sweeper is the one requirement with no frontend reference implementation** — a browser cannot run a scheduler, so the mock simply does not have it. There is no TypeScript to port and nothing will remind you it is missing. It is also the easiest requirement in the spec to forget entirely.

Three rules for all three jobs:

1. Each opens its **own** session and commits it. Never share a request session across a thread.
2. Status changes still go through `services/complaints/lifecycle.py` (Part 6.1) — so `SYSTEM` transitions get proper history rows like everything else.
3. The sweeper reads the timeout from `app_settings` **on every run**, so an admin's change takes effect without a restart. Make it idempotent and re-entrant.

---

## Part 11 — The AI adapter (`app/infra/ai/`)

There are exactly **two** AI features — photo pre-screening and zone health reports. Both are asynchronous background jobs (Part 14); **no request path ever waits on the model.**

```python
class AiProvider(Protocol):
    def screen_photo(self, path: str, category: str) -> ScreenResult | None: ...
    def zone_report(self, stats: dict) -> ReportResult | None: ...
```

| Implementation | Use |
|---|---|
| `LocalModelProvider` | the real local vision / text model |
| `StubProvider` | canned deterministic results, for dev and CI |
| `NullProvider` | always unavailable; use it to test every fail-soft path |

Three non-negotiables in the wrapper:

1. ⚠️ **A hard timeout** on every call (5–10 s).
2. ⚠️ **`None` on any failure.** The adapter catches everything. Callers see `None` and write `UNAVAILABLE` / `aiAvailable: false`. **No AI exception may ever reach a route.**
3. ⚠️ **A circuit breaker.** After N consecutive failures, short-circuit to `None` for a cooldown window — otherwise a dead model leaves 200 queued photo uploads each waiting out a 10-second timeout.

### Category suggestion is not an AI feature

There is no `suggest_category` on the protocol and no `/ai/suggest-category` endpoint — both were removed in contract 3.0.0. The 12 categories are seeded once and never change (`complaint_categories`), which is precisely the regime where a fixed lexicon beats a model, so the whole feature lives client-side in `frontend/src/lib/categoryMatcher.ts`: it scores the description against keywords keyed on `Category.code`, abstains unless the winner clears an absolute floor *and* a margin over the runner-up, and needs no network, no model, and no fail-soft path because there is nothing to fail.

The backend's only involvement is recording `complaints.category_suggested_by_matcher` exactly as the client reports it, for analytics. ⚠️ **Do not re-derive it server-side** and do not treat it as authoritative for routing — `categoryId` is always the citizen's confirmed choice.

---

## Part 12 — Photo storage (`app/infra/storage.py`)

Validate then persist:

- JPEG or PNG only — ⚠️ check **magic bytes**, not just the `Content-Type` header, which a client controls.
- Maximum 5 MB per photo; 1–3 photos per complaint.
- Write to `UPLOAD_DIR/<complaint_id>/<uuid>.<ext>`; store that relative path in `complaint_evidence.file_path`.
- ⚠️ Never store the client's filename (path traversal), and never store the image bytes in SQLite.

Evidence rows are append-only and use `sequence`: 1..N are the original photos, N+1 onward are re-submissions and dispute photos. Old rows are always retained.

### Serving them back: `GET /evidence/{evidenceId}/photo`

`UPLOAD_DIR` sits **outside the web root** and is never served as a static directory. The one way an image leaves the server is the signed route added to the contract in v2.1.0:

```python
# app/core/signing.py
def sign_photo_url(evidence_id: int, ttl: int = PHOTO_URL_TTL_SECONDS) -> str:
    exp = int(time.time()) + ttl
    raw = f"{evidence_id}|{exp}".encode()
    sig = base64.urlsafe_b64encode(
        hmac.new(PHOTO_SIGNING_KEY, raw, hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"/api/v1/evidence/{evidence_id}/photo?exp={exp}&sig={sig}"
```

Three rules, and the whole design rests on them:

1. ⚠️ **Only a serializer mints a URL.** `sign_photo_url()` is called at the moment a complaint, feed item, or evidence row is serialized — i.e. *after* the read-side visibility check has already decided this caller may see the parent complaint. The signature simply carries that decision to the browser, which cannot attach a bearer token to an `<img>` tag.
2. ⚠️ **The route verifies the signature and nothing else.** No JWT, no session, no zone lookup — `security: []` in the contract is deliberate. Use `hmac.compare_digest`, reject `exp <= now`, and return **403 for a bad signature *and* for a missing evidence row alike**. A 404 would let anyone enumerate which evidence IDs exist.
3. **`PHOTO_URL_TTL_SECONDS` defaults to 24 h** and links are re-minted on every read, so ordinary navigation never sees a broken image. Set `Cache-Control: private, max-age=<remaining TTL>` so the browser caches the image exactly as long as the link is valid and no shared proxy caches it at all.

> The photo itself is not private data in the way the reporter's name is — the public feed shows it to every logged-in citizen by design. What the signature buys is that a photo URL is not a *permanent* handle: nothing shareable outlives its window, and a leaked link expires on its own.

---

## Part 13 — Configuration

`app/settings.py`, environment-driven, with safe development defaults:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | SQLite path |
| `JWT_SECRET` | ⚠️ must **fail fast at startup** if unset outside development |
| `JWT_TTL_HOURS` | 24. Also reported to the client as `AuthResponse.expiresAt`; no refresh endpoint exists |
| `PHOTO_SIGNING_KEY` | ⚠️ separate secret from `JWT_SECRET`; same fail-fast rule |
| `PHOTO_URL_TTL_SECONDS` | 86400 (24 h) |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | 5 MB |
| `AI_PROVIDER`, `AI_TIMEOUT_SECONDS` | `local` / `keyword` / `null` |
| `CLUSTER_RADIUS_METERS` | 100 |
| `AUTO_CLOSE_SWEEP_MINUTES` | 15 |

Never commit `.env` files or `*.sqlite3` — both are already in `.gitignore`.

### Runtime shape

```text
    Flask app  (gunicorn --workers 1 --threads 8, or flask run in dev)
    ├── HTTP request threads ──┐
    ├── APScheduler thread ────┼──▶ SQLAlchemy sessionmaker ──▶ SQLite (WAL)
    └── AI job thread pool ────┘                                    │
        (bounded, 2–4)                                       uploads/ on disk
```

⚠️ Use **threads, not multiple processes**, while on SQLite. Several gunicorn *processes* against one SQLite file produce `SQLITE_BUSY` under write contention. If the app ever outgrows this, the only change is Postgres plus more workers — nothing in this architecture assumes SQLite.

---

## Part 14 — Testing

Four layers, weighted heavily toward the cheapest:

| Layer | What | Speed |
|---|---|---|
| **`tests/domain/`** | Pure rules: every legal and illegal transition; SLA pause/resume; severity band boundaries (4/5, 14/15, 29/30); SLA thresholds (79/80/99/100 %); badge criteria | milliseconds, no DB |
| **`tests/services/`** | In-memory SQLite + factories: cluster linking and cascade, the one-time reward under two concurrent confirms, points on confirm vs auto-close vs rejected dispute | fast |
| **`tests/api/`** | Flask test client: status codes, error codes, and ⚠️ **one privacy assertion per role-visible endpoint** | medium |
| **`tests/contract/`** | Validate responses against `openapi.yaml` using `schemathesis` or an `openapi-core` response validator | medium |

Most of your tests should be in the first row. That is the payoff for keeping `domain/` pure.

### Two shortcuts you should take

**1. Port `lifecycle.test.ts` to pytest before implementing the lifecycle.** `frontend/src/mocks/integration/lifecycle.test.ts` already encodes the cluster cascade, dispute-review flow and reward-once behaviour as executable assertions. Porting it gives you a specification of the hardest cases *before* you write them, rather than discovering them one bug at a time.

**2. Make "the real frontend works" a milestone gate.** The frontend can run against your backend by setting `VITE_USE_MOCKS=false` and pointing `VITE_API_BASE_URL` at Flask. Its ~52 hooks each exercise a real endpoint. If the whole app works with mocks off, the contract is genuinely satisfied — which no amount of unit testing proves on its own.

---

## Part 15 — The six contract gaps, and how each was closed

An earlier draft of this document listed six things the contract did not answer. All six are now settled **in the contract itself** — `openapi.yaml` v2.1.0 and the matching `schema.dbml` notes — so this section is a summary of decisions, not a to-do list. The authority is still those two files; if this table and the contract ever disagree, the contract wins.

| # | Gap | Decision | Where it now lives |
|---|---|---|---|
| 1 | No endpoint served photos | Signed, expiring URL route | new path `/evidence/{evidenceId}/photo`; `photoUrl` descriptions; `file_path` note |
| 2 | Token lifetime undefined | 24 h, no refresh, `expiresAt` in the response | `AuthResponse.expiresAt` (required); `info.description` → Authentication |
| 3 | `avgResolutionHours` undefined in 3 places | One shared definition, three stated samples | new `AvgResolutionHours` schema, `$ref`'d by all three fields |
| 4 | Leaderboard ties / deactivated citizens | Total ordering, sequential ranks, inactive excluded | `GET /leaderboard` description; `users.is_active` note |
| 5 | Auto-close timing | Live rule re-read each sweep; cadence is config | `PATCH /admin/settings` description; `auto_close_timeout_hours` note |
| 6 | Officer visibility after a zone change | Current zone, evaluated per request → `403` | `GET /complaints/{complaintId}` description |

The reasoning behind each, since a decision without its reason gets undone by the next person:

**1. Photos are served through a signed, expiring link.** The deciding constraint came from the frontend, not the backend: every photo in the app is rendered by a plain `<img src={photoUrl}>` (see [EvidenceGallery.tsx](../../frontend/src/components/complaint/EvidenceGallery.tsx#L65), [FeedPage.tsx](../../frontend/src/pages/citizen/FeedPage.tsx#L340)), and an `<img>` tag cannot send an `Authorization` header. A bearer-protected photo route would have forced every image in the product through a manual fetch-and-blob detour — a large frontend change to buy a check the server has *already performed* when it decided to include the complaint in the response at all. So the server signs instead: the read-side visibility rules stay the single place authorization happens, and the signature carries that verdict to the browser. It expires, so no photo URL is a permanent shareable handle. Implementation is in Part 12.

**2. 24-hour tokens, no refresh endpoint, `expiresAt` on the response.** Adding a refresh flow means refresh-token storage, rotation, and revocation — real machinery for a single-device civic app whose frontend already redirects to login on any `401` ([http.ts](../../frontend/src/services/http.ts)). `expiresAt` mirrors the JWT's own `exp` claim so a client can pre-empt expiry without decoding the token. ⚠️ It does **not** license the client to skip `401` handling: an admin deactivating an account must take effect immediately, which is exactly why Part 7's rule stands — re-load the user from the database on every request and never trust role or zone claims baked into the token.

**3. `avgResolutionHours` = `resolved_at − sla_started_at − sla_paused_seconds`.** The same arithmetic as `slaLabel`, deliberately: those two numbers are read side by side on the same dashboard, and a zone showing every complaint `ON_TIME` next to an average past its SLA target would destroy trust in both. Two consequences worth internalising:
- It **starts at acceptance, not filing.** Time a complaint spends queued before an officer claims it is a *backlog* problem, visible in `pending`/`overdueCount`, not a resolution-speed problem.
- It **ends at `resolved_at`, not `closed_at`.** The gap between "officer fixed it" and "citizen confirmed it" is the citizen's (or the auto-close timeout's), and charging it to the zone would make officers look worse the slower their citizens are.

> ⚠️ **The three mock implementations do not match this definition** — they use `closedAt − createdAt` or `resolvedAt − createdAt`, over three different windows ([officer.ts:475](../../frontend/src/mocks/handlers/officer.ts#L475), [admin.ts:532](../../frontend/src/mocks/handlers/admin.ts#L532), [admin.ts:654](../../frontend/src/mocks/handlers/admin.ts#L654)). That divergence is precisely the bug this gap predicted, caught in the mock before it could reach the real backend. Follow the contract, not the mock, and expect the mock to be corrected in a separate frontend change. This is the one place in the whole document where the mock is **not** a usable reference implementation.

**4. Leaderboard: a total order, sequential ranks, active citizens only.** Sort by points, then account age, then id — three keys, so the order is total and a repeated request can never interleave rows differently across pages. Ranks are sequential rather than shared (`1,2,3,4`, not `1,2,2,4`), which keeps `isTopThree` meaning exactly `rank <= 3` and keeps pagination honest. Deactivated citizens drop off the board but keep their `points_ledger` rows, so reactivation restores their standing — deactivation is a moderation tool, not a data deletion. Zero-point citizens stay on the board: a new citizen seeing themselves at the bottom is the nudge the feature exists for. ⚠️ The mock currently includes inactive citizens ([gamification.ts](../../frontend/src/mocks/handlers/gamification.ts)); the backend must filter them.

**5. Auto-close is a live rule, not a scheduled deadline.** The sweeper re-reads `auto_close_timeout_hours` every pass and closes everything where `resolved_at + timeout <= now`. Nothing is scheduled per complaint, so lowering the setting can close a backlog on the next pass and raising it hands time back — but nothing already `CLOSED` is ever reopened. `AUTO_CLOSE_SWEEP_MINUTES` (15) is deployment config, not contract: it bounds only how *late* a close lands.
The second half of this question turned out to be already answered, and reading the contract more carefully was the whole fix: `POST /complaints/{id}/dispute` is valid "only while the complaint is in the `RESOLVED` stage" and returns **409** otherwise. So a citizen who lets the timeout elapse does lose the dispute option — intended, and the reason `autoCloseTimeoutHours` defaults to a generous 168 h (7 days).

**6. Officer visibility follows the officer's *current* zone, re-read every request.** Not the zone in their token, not `assignedOfficerId`. An officer moved to a new zone loses access to their old zone's complaints immediately — including ones they personally worked — and gets `403`, matching the shared "wrong role or wrong zone" response. This is the same rule that already clears `assignedOfficerId` on those complaints at reassignment time (`POST /admin/zones/{zoneId}/assign-officer`): the system never leaves a complaint assigned to someone who cannot open it. ⚠️ The cost is that an officer's own past work is not permanently readable *to them*; `status_history` preserves the audit trail and admins retain full access.

### What still needs doing outside the contract

None of these blocks backend work, but they should not be forgotten:

- **The frontend mock now diverges from the contract in three spots** — `avgResolutionHours` (item 3), leaderboard `is_active` filtering (item 4), and `AuthResponse.expiresAt`, which the mock does not emit. These are a separate frontend change, per the one-concern-per-PR rule.
- **`frontend/src/types/api.generated.ts` has been regenerated** from the new contract (`npm run gen:types`); `tsc -b` passes. Re-run it after any further contract edit.
- **The photo route has no frontend work attached** — `photoUrl` stays an opaque string that goes straight into `<img src>`, exactly as today.

---

## Part 16 — Cheat sheets

### 16.1 Status transitions

| From | To | Door | Notes |
|---|---|---|---|
| `SUBMITTED` | `EVIDENCE_UNDER_REVIEW` | claim | Only door out of `SUBMITTED`; sets `assignedOfficerId` |
| `EVIDENCE_UNDER_REVIEW` | `UNDER_REVIEW` | evidence-review `VALID` | **SLA clock starts** |
| `EVIDENCE_UNDER_REVIEW` | `NEEDS_MORE_EVIDENCE` | evidence-review | reason required |
| `EVIDENCE_UNDER_REVIEW` | `REJECTED` | evidence-review | ⚠️ first round only; reason required; −20 CSP; **terminal** |
| `NEEDS_MORE_EVIDENCE` | `EVIDENCE_UNDER_REVIEW` | citizen re-uploads | resumes the clock if it had started |
| `UNDER_REVIEW` | `IN_PROGRESS` | officer status | |
| `UNDER_REVIEW` | `NEEDS_MORE_EVIDENCE` | officer status | reason required; **pauses the clock** |
| `IN_PROGRESS` | `UNDER_RESOLUTION` | officer status | |
| `UNDER_RESOLUTION` | `RESOLVED` | officer status | ⚠️ **cascades to the cluster** |
| `RESOLVED` | `CLOSED` | citizen confirm | **credits points** |
| `RESOLVED` | `CLOSED` | auto-close (SYSTEM) | **no points** |
| `RESOLVED` | `REOPENED` | citizen dispute | reason **and** photo both required |
| `REOPENED` | `IN_PROGRESS` | admin dispute-review `UPHELD` | ⚠️ admin only |
| `REOPENED` | `CLOSED` | admin dispute-review `REJECTED` | ⚠️ admin only; **no points** |
| `UNDER_REVIEW` / `IN_PROGRESS` / `UNDER_RESOLUTION` | `UNRESOLVABLE` | officer status | reason required; **terminal** |
| *(eligible siblings)* | `RESOLVED` | cluster cascade (SYSTEM) | only from `UNDER_REVIEW` / `IN_PROGRESS` / `UNDER_RESOLUTION` |

Terminal: `REJECTED`, `CLOSED`, `UNRESOLVABLE`.

### 16.2 Bands and thresholds

| Severity | Score |     | SLA | % of target consumed |
|---|---|---|---|---|
| `LOW` | 0–4 | | `ON_TIME` | < 80 % |
| `MEDIUM` | 5–14 | | `DELAYED` | 80–100 % |
| `HIGH` | 15–29 | | `OVERDUE` | > 100 % |
| `CRITICAL` | 30+ | | | |

### 16.3 Endpoint → package map

| Path prefix | Package | Role |
|---|---|---|
| `/auth/*` | `api/auth/` | public |
| `/users/me*` | `api/account/` | any authenticated |
| `/categories`, `/zones`, `/zones/suggest` | `api/reference/` | public (except `suggest`, which needs auth) |
| `/complaints/*`, `/feed`, `/gamification/*`, `/leaderboard` | `api/citizen/` | citizen |
| `/officer/*`, `/officers/{id}/stats` | `api/officer/` | officer (stats: any authenticated) |
| `/admin/*` | `api/admin/` | admin |
| `/clusters*`, `/zones/{id}/summary` | `api/shared/` | officer + admin |
| `/evidence/{id}/photo` | `api/shared/` | anyone holding a valid signature — no token |

### 16.4 The fourteen ⚠️ rules, in one list

1. Every status write goes through `services/complaints/lifecycle.py`. Nowhere else assigns `complaint.status`.
2. Guard every transition with a conditional `UPDATE ... WHERE status = <expected>`; `rowcount` is the decision.
3. The cluster's +50 reward is an atomic test-and-set on `reward_granted`, in the same transaction as the close.
4. `REJECTED` is legal only on a complaint's first evidence round (`sla_started_at IS NULL`).
5. `REOPENED` may only be moved by the admin dispute-review endpoint — never by the status, batch, or cascade paths.
6. Paused time never counts against the SLA; pause only accrues once the clock has actually started.
7. `reporter` is emitted only by `api/admin/`. `full_name` never reaches another citizen or an officer.
8. Re-load the user row on every request; never authorize from JWT claims alone.
9. Turn on `PRAGMA foreign_keys=ON`, or every FK rule in the schema is inert.
10. The catch-all zone constraint is a **partial** unique index, not a column constraint.
11. AI never raises and never blocks a core flow; its failure mode is `None`.
12. Auto-close and admin-rejected disputes credit **zero** points.
13. Photo URLs are minted only by a serializer, after the visibility check; the photo route verifies the signature alone and answers `403` — never `404` — for anything it will not serve.
14. `avgResolutionHours` is `resolved_at − sla_started_at − sla_paused_seconds` in all three dashboards. The frontend mock computes it three other ways; the contract wins.

---

## Appendix — Suggested build order

Each phase leaves the app runnable and unblocks a slice of the (already complete) frontend.

| Phase | Delivers | Unblocks |
|---|---|---|
| **1. Skeleton** | app factory, config, all 14 models, migrations, seed, error envelope, health check | everything |
| **2. Auth + reference** | register / login / JWT, `/users/me*`, `/categories`, `/zones`, `/zones/suggest` | login, registration, complaint-form prefill |
| **3. Complaint core** | create (multipart + storage), `/complaints/my`, detail, `domain/lifecycle` + the lifecycle service, `status_history` | citizen dashboard |
| **4. Officer flow** | queue, claim, evidence-review, status, notes — the full FSM including SLA start/pause/resume | officer role end to end |
| **5. Clusters** | linking on create, severity recompute, cascade, batch-status, cluster notes, `/clusters*` | officer cluster pages |
| **6. Gamification** | upvote, confirm / dispute, points ledger, badge engine, leaderboards | citizen gamification page |
| **7. Admin** | users, zones, SLA, settings, override, dispute-review, analytics, officer performance, CSV export | admin role |
| **8. AI + jobs** | adapter + 3 providers, screening job, zone report, **auto-close sweeper** | AI-dependent UI and the timeout rule |

Phases 3 and 4 carry the real risk. Everything after them is comparatively mechanical. Do not leave phase 8's sweeper to the end and then forget it.
