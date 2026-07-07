# Kartavya Database — Table Documentation

> **Version:** Schema v2 · **Database:** SQLite (via SQLAlchemy + Flask)
> **Audience:** The full team — backend, frontend, QA, and PM. No prior database experience assumed.

---

## How to Read This Document

The database has **14 tables** split into four logical groups. Each table section explains:

- **What it is** — one sentence on what real-world thing this table represents.
- **Why it exists** — the design thinking behind it.
- **Every column** — what each field stores, what values it can hold, and whether it is required.
- **Constraints and indexes** — the rules the database itself enforces, and why.
- **Relationships** — which other tables it connects to, and what happens when rows are deleted.
- **A plain example** — a concrete sample row so the data feels real.

At the very top of the schema, before any table, we define **Enums**. These are fixed lists of allowed values — think of them like multiple-choice options. A column typed as an Enum can only store exactly one of the listed values; anything else is rejected outright by the database. This is explained first because many column types below are Enums.

---

## Part 0 — Enums (The Fixed Value Lists)

Wherever a column can only ever hold a specific set of values, we define an Enum instead of using a plain text field. A plain text field allows anything — "submitted", "Submitted", "SUBMMITED" — three spellings, three bugs. An Enum allows exactly one thing from its list, so a typo is caught at the database level before it can corrupt data.

---

### `user_role`
The three kinds of accounts in Kartavya.

| Value | Who it represents |
|---|---|
| `CITIZEN` | A member of the public who files complaints |
| `OFFICER` | A government/municipal official managing one zone |
| `ADMIN` | The platform manager with full access to everything |

---

### `complaint_status`
The 11 stages a complaint can be in. The database only stores the current stage; the full journey is preserved in `status_history`. The allowed transitions are enforced by the application code.

| Value | What it means |
|---|---|
| `SUBMITTED` | Just filed by the citizen. Waiting for an officer to open it. |
| `EVIDENCE_UNDER_REVIEW` | An officer has opened it and is judging the photo. |
| `NEEDS_MORE_EVIDENCE` | Officer rejected the photo quality. Citizen must resubmit. SLA timer is paused here. |
| `REJECTED` | Turned down as fake or invalid. A reason is mandatory. **Terminal — goes no further.** |
| `UNDER_REVIEW` | Photo accepted. Complaint enters the work queue. **SLA timer starts here.** |
| `IN_PROGRESS` | Officer has started investigating the issue. |
| `UNDER_RESOLUTION` | Officer is actively fixing it. Progress notes are allowed. |
| `RESOLVED` | Officer says it's done. Now waiting for the citizen to confirm. |
| `CLOSED` | Citizen confirmed the fix. Points credited. **Terminal — the happy ending.** |
| `REOPENED` | Citizen disputed the fix. Sent back to the officer with a reason. |
| `UNRESOLVABLE` | Officer cannot fix it due to budget, elections, or something beyond their control. Reason is mandatory. **Terminal.** |

> **What "terminal" means:** Once a complaint reaches `REJECTED`, `CLOSED`, or `UNRESOLVABLE`, it cannot be moved again. Its story is over.

---

### `severity_label`
The urgency label shown to officers and on the public feed. **This label is never stored in the database.** It is always calculated on the fly from `complaints.severity_score` using these ranges. Storing it would create two sources of truth that could disagree.

| Value | Score range | What it means |
|---|---|---|
| `LOW` | 0 – 4 | Minor, isolated issue |
| `MEDIUM` | 5 – 14 | Affects a few people |
| `HIGH` | 15 – 29 | Widespread, needs prompt attention |
| `CRITICAL` | 30+ | Dangerous or affecting many; should be first in queue |

The score formula is: `(number of nearby linked complaints − 1) × 3 + number of upvotes`. Every new linked complaint and every new upvote recalculates the score instantly.

---

### `sla_label`
Whether a complaint is on track against its target resolution time. Like `severity_label`, this is **always derived on read** — never stored — so it can never be stale.

| Value | When it applies |
|---|---|
| `ON_TIME` | Less than 80% of the target time has been used |
| `DELAYED` | Between 80% and 100% of target time used — getting close |
| `OVERDUE` | Target time exceeded — needs attention now |

---

### `evidence_verdict`
The three decisions an officer can give after reviewing a photo.

| Value | What happens |
|---|---|
| `VALID` | Photo accepted. Complaint moves to `UNDER_REVIEW`. SLA clock starts. |
| `NEEDS_MORE_EVIDENCE` | Photo unclear. Citizen is asked to resubmit. |
| `REJECTED` | Photo rejected as fake/irrelevant. Citizen loses 20 CSP. Requires a reason. |

---

### `ai_screen_status`
The state of the AI photo pre-screening process for each piece of evidence. This is crucial because pre-screening runs **asynchronously** (in the background), so there are three distinct states the frontend needs to handle.

| Value | What it means |
|---|---|
| `PENDING` | Photo was just uploaded; AI hasn't finished screening yet |
| `DONE` | AI has returned a result (see `ai_confidence`, `ai_note`) |
| `UNAVAILABLE` | AI service was offline when the photo was uploaded; treat hint as absent |

---

### `status_actor`
Who or what caused a complaint's status to change. Needed because the `SYSTEM` actor handles automated transitions (like auto-closing a `RESOLVED` complaint after the timeout, or cascading a resolved cluster's members to `RESOLVED` together) — there is no human user behind those changes. This is a distinct API enum (`StatusActor`) from `Role`, precisely because `Role` has no `SYSTEM` value — reusing `Role` here would make `SYSTEM`-actor rows unrepresentable.

| Value | Meaning |
|---|---|
| `CITIZEN` | The citizen acted (confirm fix, dispute, submit more evidence) |
| `OFFICER` | An officer moved the status |
| `ADMIN` | An admin overrode the complaint |
| `SYSTEM` | An automated process (e.g. the auto-close timeout) |

---

### `points_reason`
The six reasons why a citizen's CSP (Community Service Points) can change. Using an Enum instead of free text means the app can reliably query "how many rejections happened this month?" without worrying about spelling variants.

| Value | Points change | When it triggers |
|---|---|---|
| `COMPLAINT_CLOSED` | +50 | A complaint the citizen filed reaches `CLOSED`. For a clustered complaint, only the first member confirmed by its citizen earns this — see [Table 10](#table-10-points_ledger). |
| `CLUSTER_MEMBER_CLOSED` | +10 | A citizen confirms their own complaint in a cluster where another member already won the `COMPLAINT_CLOSED` reward |
| `FIRST_COMPLAINT` | +10 | One-time bonus when a citizen files their very first complaint |
| `ON_TIME_BONUS` | +15 | The complaint was resolved within the SLA target time |
| `UPVOTE_RECEIVED` | +5 | Per unique upvote received on any complaint the citizen filed |
| `REJECTED_PENALTY` | −20 | The officer rejected the citizen's complaint as fake or invalid |

---

### `badge_code`
The six badges a citizen can earn. Using a code ensures every badge has exactly one canonical identifier.

| Value | Badge Name |
|---|---|
| `KARTAVYA_INITIATE` | Kartavya Initiate — first complaint filed |
| `STREET_GUARDIAN` | Street Guardian — 5 complaints resolved |
| `ZONE_CHAMPION` | Zone Champion — ranked #1 in their zone |
| `CENTURY_REFORMER` | Century Reformer — 100 lifetime CSP |
| `CIVIC_HERO` | Civic Hero — 500 lifetime CSP |
| `SWIFT_REPORTER` | Swift Reporter — 3 complaints resolved within 7 days |

---

### `badge_criteria_type`
How a badge is earned. The old approach only supported "earn X points" — this Enum makes the award logic data-driven so all six badge types (including event-based and time-window ones) are handled without special-casing.

| Value | What triggers the award |
|---|---|
| `FIRST_COMPLAINT` | Fires the moment a citizen files their first complaint |
| `COMPLAINTS_CLOSED` | Fires when the citizen's closed complaint count hits `criteria_value` |
| `LIFETIME_POINTS` | Fires when lifetime CSP crosses `criteria_value` |
| `ZONE_RANK_ONE` | Fires when the citizen reaches position #1 on their zone leaderboard |
| `CLOSED_WITHIN_DAYS` | Fires when 3 complaints are closed within `criteria_value` days |

---

### `ai_report_status`
The three states of an AI zone health report. Generation is asynchronous, so the frontend needs to know whether to show a loading state, the result, or an error.

| Value | Meaning |
|---|---|
| `PENDING` | Report generation has been triggered; not ready yet |
| `READY` | Report is complete and its text is stored |
| `FAILED` | AI service was unavailable; the report could not be generated |

---

## Part 1 — Accounts & Reference Data

These three tables are the foundation everything else is built on. They hold accounts, geographic zones, and the fixed category list. They are mostly stable after initial setup.

---

## Table 1: `users`

### What it is
Every person with an account in Kartavya — citizens, officers, and admins — is a single row in this table. There is no separate `citizens` table or `officers` table; the `role` column is what distinguishes them.

### Why one table for all roles
All three roles share the same core identity data: name, email, password. Splitting them into separate tables would make login more complex (which table do we check?), and it would make the foreign-key references from `complaints`, `status_history`, etc. duplicated across three places. One table keeps it clean.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Auto-incrementing primary key. This `id` is what the API refers to as `userId` and `officerId`. An officer's "public ID" shown to citizens is just this number — the name is never exposed. |
| `full_name` | varchar(120) | ✅ | The real name of the person. **Never shown to other citizens, to officers (in their queue), or on the public feed.** Only visible to admins. |
| `display_name` | varchar(60) | ❌ | A public-facing handle or nickname used on leaderboards where names can't be shown. If left blank, the app generates a masked placeholder like "Citizen #1042". |
| `email` | varchar(255) | ✅ | Login credential. **Unique across the entire table and all roles.** This uniqueness is what physically prevents an officer from self-registering — if their email already exists (because an admin created it), registration fails. |
| `password_hash` | varchar(255) | ✅ | The bcrypt/argon2 hash of the password. The plaintext password is never stored anywhere. |
| `role` | `user_role` | ✅ | `CITIZEN`, `OFFICER`, or `ADMIN`. Controls which API endpoints and data they can access. |
| `zone_id` | integer (FK) | ❌ | For officers: the one zone they are assigned to and responsible for. For citizens: the zone they live in or report from — required at registration (`RegisterRequest.zoneId`), so in practice every citizen has one. For admins: always `NULL` (admins have cross-zone access). **This FK is `RESTRICT` on delete**, and applies equally to citizens and officers: a zone can't be hard-deleted (`DELETE /admin/zones/{zoneId}`) while *any* user — citizen or officer — still has it as their `zone_id`, not just zones with complaints or assigned officers. |
| `is_active` | boolean | ✅ | `true` by default. Set to `false` to deactivate an account. **Deactivated users cannot log in, but all their complaints, history, and points are preserved.** Preferred over deletion because deleting a user who has filed complaints would break those records. |
| `created_at` | datetime | ✅ | Auto-set to the current time when the account is created. |

### Constraints & Indexes
- `email` has a **UNIQUE** constraint — the primary anti-fraud measure for registration.
- Indexes on `role` (filter all officers or all citizens quickly) and `zone_id` (find all users in a zone for analytics).

### Relationships
- Connected **to** `zones` via `zone_id`. If a zone were deleted, this is set to `NULL` (the user is not deleted, just no longer zone-assigned).
- Many other tables point **back to** `users` (complaints, notes, status history, points, etc.). For audit records, deleting a user is blocked; for actor references (who reviewed a photo), the pointer becomes `NULL`.

### Example row

```
id: 5
full_name: Asha Verma
display_name: asha_v
email: asha@example.com
password_hash: $2b$12$...
role: CITIZEN
zone_id: 3
is_active: true
created_at: 2026-07-01 09:00:00
```

---

## Table 2: `zones`

### What it is
A zone is a geographic area of the city — like a municipal ward — that groups complaints and officers together. Every complaint belongs to a zone, and every officer is responsible for exactly one zone.

### Why it exists
The entire access-control model of Kartavya is built on zones. An officer can only see complaints in their zone. Analytics are calculated per zone. The citizen's zone determines which officer queue their complaint lands in. Without this table, none of that routing is possible.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. Referenced as `zoneId` throughout the API. |
| `zone_code` | varchar(20) | ✅ | A short machine-readable code, e.g. `WARD-12-N`. **Unique.** Used in URLs and CSV exports. |
| `zone_name` | varchar(120) | ✅ | Human-readable name shown in the UI, e.g. "Ward 12 – North". |
| `center_lat` | float | ✅ | Latitude of the zone's centre point. Routing uses **nearest-centroid**: a location belongs to whichever zone's centre it is closest to. This always yields exactly one zone for any coordinate — no gaps, no overlaps, no polygon GIS needed. |
| `center_lng` | float | ✅ | Longitude of the zone's centre point. |
| `is_catch_all` | boolean | ✅ | **Exactly one row must have this set to `true`.** That is the "Unassigned" zone. Because nearest-centroid always matches something, this exists for locations far outside the city where every real zone's centre is a poor match, so an admin can route the complaint manually instead. |
| `is_active` | boolean | ✅ | Soft-deactivate flag, default `true`. A deactivated zone stops accepting new complaints but keeps all its history — the safe alternative to deleting a zone that already has data. Enforced two ways on `POST /complaints`: an explicitly-submitted `zoneId` for an inactive zone is rejected with `400`; an omitted `zoneId` is derived via nearest-centroid over active zones only, so inactive zones are never silently auto-selected either. |
| `created_at` | datetime | ✅ | When the zone was added by an admin. |

### Relationships
- `users.zone_id` → `zones.id` — users are associated with a zone.
- `complaints.zone_id` → `zones.id` — each complaint belongs to a zone (determined by location at submit time).
- `complaint_clusters.zone_id` → `zones.id` — clusters are zone-specific.

### Example rows

```
id: 1  zone_code: UNASSIGNED   zone_name: Unassigned  is_catch_all: true   is_active: true  center_lat: 0  center_lng: 0
id: 2  zone_code: WARD-12-N    zone_name: Ward 12 – North  is_catch_all: false  is_active: true  center_lat: 12.9716  center_lng: 77.5946
id: 3  zone_code: WARD-07-S    zone_name: Ward 7 – South   is_catch_all: false  is_active: true  center_lat: 12.9510  center_lng: 77.5712
```

---

## Table 3: `complaint_categories`

### What it is
The 12 fixed civic issue types a citizen can choose from when filing a complaint. Examples: Pothole, Open Manhole, Broken Street Light, Garbage Overflow.

### Why it is a table (not hardcoded)
The category list is fixed and cannot be added to or removed from the running app. But each category's **SLA target time** (`sla_hours`) _can_ be changed by an admin. Storing categories in a table means the admin can update a time through the API without a code change, while the list itself stays locked.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. Referenced as `categoryId` in the API and in complaints. |
| `category_code` | varchar(40) | ✅ | Short code like `POTHOLE` or `OPEN_MANHOLE`. **Unique.** Safe to use in exports and logs. |
| `category_name` | varchar(120) | ✅ | Display name shown in the UI, e.g. "Pothole" or "Open Manhole". **Unique.** |
| `description` | text | ❌ | A sentence explaining what counts as this category, e.g. "A hole in the road surface that can damage vehicles." Shown on the complaint form. |
| `sla_hours` | integer | ✅ | The target number of hours in which a complaint of this type should be resolved. **Minimum 1.** Admins can change this via `PATCH /admin/slas/{categoryId}`. **Only affects new complaints accepted after the change** — complaints already in progress keep their original target. |
| `created_at` | datetime | ✅ | When this category was seeded/added. |

### Important rule: SLA snapshot
When a complaint is accepted (enters `UNDER_REVIEW`), the application copies `sla_hours` from this table into `complaints.sla_target_hours`. After that point, the complaint's deadline is independent of this table. This means an admin can change an SLA mid-month without worrying about unfairly moving deadlines for complaints already being worked on.

### Example rows (the 12 seeded categories)

```
id: 1   category_code: POTHOLE          category_name: Pothole            sla_hours: 72
id: 2   category_code: OPEN_MANHOLE     category_name: Open Manhole       sla_hours: 6
id: 3   category_code: BROKEN_STREETLIGHT  category_name: Broken Street Light  sla_hours: 24
id: 4   category_code: GARBAGE_OVERFLOW category_name: Garbage Overflow   sla_hours: 48
...
```

---

## Part 2 — Complaints Domain

This is the heart of the database. These six tables cover the entire journey of a complaint from filing to closure, including the evidence photos, every status change, officer notes, and community upvotes.

---

## Table 4: `complaint_clusters`

### What it is
A cluster groups together nearby complaints of the same type. If five people file "Pothole" complaints within 100 metres of each other, they are all linked to one cluster row.

### Why it exists
The charter requires "auto severity" — the system should automatically judge that a widely-reported problem is more serious than an isolated one. Clusters are how the system detects that "nearby same-type problem." When a new complaint comes in, the app checks whether an existing cluster exists nearby; if yes, it links the complaint to it and increments `report_count`. If no, it creates a new cluster.

Clusters also implement the reward-dedup rule: only one member's citizen ever gets the full `COMPLAINT_CLOSED` bonus for the cluster — whoever confirms first, not whoever reported first. See "Cluster reward distribution" below.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. Referenced by `complaints.cluster_id`. |
| `category_id` | integer (FK) | ✅ | The complaint type all members of this cluster share. A Pothole cluster only groups Pothole complaints. |
| `zone_id` | integer (FK) | ✅ | The zone this cluster is in. Keeps cluster lookup fast (you only search clusters in your zone). |
| `centroid_lat` | float | ✅ | Latitude of the cluster's centre — the average position of its member complaints. Updated as new complaints join. |
| `centroid_lng` | float | ✅ | Longitude of the cluster's centre. |
| `report_count` | integer | ✅ | How many complaints are currently linked to this cluster, including repeats from the same citizen. **Starts at 1 when created.** |
| `unique_reporter_count` | integer | ✅ | Distinct citizens in the cluster. **This — not `report_count` — drives the severity score**: `(unique_reporter_count - 1) × 3 + upvotes`, so one citizen filing the same issue twice cannot inflate urgency. |
| `reward_granted` | boolean | ✅ | `false` until the one-time +50 `COMPLAINT_CLOSED` bonus has been paid to whichever member confirmed first. Once `true`, every later confirmation in this cluster gets `CLUSTER_MEMBER_CLOSED` (+10) instead. |
| `created_at` | datetime | ✅ | When the cluster was first formed (when the second nearby complaint joined). |
| `updated_at` | datetime | ✅ | Updated every time a new complaint joins the cluster or `report_count` changes. |

### Indexes
A composite index on `(category_id, zone_id)` makes the "is there already a cluster nearby of this type in this zone?" lookup fast at complaint submission time.

### Example scenario
Citizen A files a Pothole complaint at 12.97°N, 77.59°E.
→ No existing nearby Pothole cluster in zone → a new `complaint_clusters` row is created with `report_count = 1`, `unique_reporter_count = 1`.

Citizen B files another Pothole complaint 60 metres away.
→ The app finds the existing cluster (Haversine distance < 100 m) → links B's complaint to it → `report_count` and `unique_reporter_count` both become 2 → both complaints' `severity_score` updates to `(2-1) × 3 = 3`.

### Cluster reward distribution
When the officer resolves the shared issue, every member cascades to `RESOLVED` together (a `SYSTEM`-actor `status_history` entry per complaint). Confirmation is still per-complaint — each citizen confirms or disputes only their own:
- The **first** citizen whose confirmation succeeds wins the full `COMPLAINT_CLOSED` bonus (+50), and `reward_granted` flips to `true`.
- Every other citizen who confirms afterward gets `CLUSTER_MEMBER_CLOSED` (+10) instead — their complaint still closes normally, they just don't get the full reward a second time.
- `ON_TIME_BONUS` (+15) is unaffected by any of this — it's evaluated per-complaint against that complaint's own `sla_target_hours`/`sla_started_at`, so a citizen who only gets +10 can still separately earn the on-time bonus.
- If a citizen disputes instead of confirming, only their complaint detaches from the cluster (`cluster_id` set to `null`) and is handled individually from then on; it never re-fires `reward_granted` even if later re-closed.

---

## Table 5: `complaints`

### What it is
The central record of every civic complaint filed on the platform. This is the most important table in the entire database.

### Why it is designed this way
Almost everything else in the database is a child of a complaint (evidence, history, notes, upvotes). The `complaints` table stores the core facts that don't change (who filed it, where, what category) alongside the evolving state (current status, severity score, SLA tracking). Non-changing facts are stored once here; historical facts are appended to child tables.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Internal primary key. |
| `complaint_code` | varchar(30) | ✅ | **Unique, human-friendly identifier** shown in the UI — e.g. `KTV-2026-000123`. Makes it easy to reference a complaint in conversation without saying "complaint number 3847." |
| `citizen_id` | integer (FK) | ✅ | The user who filed this complaint. **Hidden from officers and from the public feed** — anonymization is enforced here at the query level. |
| `zone_id` | integer (FK) | ✅ | The zone the citizen confirmed at filing time (client pre-selects via `/zones/suggest` from photo EXIF GPS, or manual choice; server trusts it but rejects it if the zone is inactive). If omitted, derived from latitude/longitude instead. Snapshotted once — never recomputed — so later zone moves/renames or deactivation don't retroactively alter old complaints. Can be admin-overridden. Determines which officer queue this complaint appears in. |
| `category_id` | integer (FK) | ✅ | Which of the 12 categories this complaint belongs to. Affects routing, SLA, and cluster matching. |
| `cluster_id` | integer (FK) | ❌ | If this complaint is part of a nearby-duplicate cluster, this points to that cluster row. `NULL` means it is a standalone complaint. |
| `assigned_officer_id` | integer (FK) | ❌ | The officer currently handling this complaint. `NULL` until an officer picks it up from the zone queue. When the complaint is batch-assigned, this is set. **Not a delete-rule effect:** if the officer is reassigned to a different zone (`PATCH /admin/users/{userId}` or `POST /admin/zones/{zoneId}/assign-officer`), application logic clears this field back to `NULL` on every one of their non-terminal complaints in the old zone — otherwise the complaint would stay assigned to someone who can no longer see it, since officer visibility is zone-scoped. |
| `description` | text | ❌ | The citizen's free-text description. **Deliberately optional** — a citizen who picks a category manually and uploads a clear photo may not need to type anything. |
| `category_ai_suggested` | boolean | ✅ | `true` if the citizen accepted the AI's category suggestion; `false` if they picked manually. Stored for analytics (to measure how useful the AI suggestion feature is). |
| `latitude` | float | ✅ | Where the issue is — latitude. Used for zone routing and cluster detection. |
| `longitude` | float | ✅ | Where the issue is — longitude. |
| `status` | `complaint_status` | ✅ | The complaint's current stage. **Defaults to `SUBMITTED`** the moment it is created. Changes are enforced by app logic and recorded in `status_history`. |
| `severity_score` | integer | ✅ | The raw numeric score. **Defaults to 0.** Updated when new related complaints join the cluster and when new upvotes are received. The severity label (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`) is calculated from this on read — never stored separately. |
| `sla_target_hours` | integer | ❌ | A **snapshot** of `complaint_categories.sla_hours` taken at the moment the complaint entered `UNDER_REVIEW`. `NULL` before that. Frozen permanently — later SLA changes by the admin do not affect this complaint. Also backfilled by an admin override (see below) if it force-jumps the complaint to `UNDER_REVIEW` or later while this is still unset. |
| `sla_started_at` | datetime | ❌ | Timestamp of when the complaint entered `UNDER_REVIEW` — **this is when the SLA clock started ticking.** `NULL` before acceptance. **Admin override backfill:** `PATCH /admin/complaints/{id}` can force `status` straight to `UNDER_REVIEW` or beyond, skipping the normal evidence-review path. If this column is still `NULL` when that happens, the app sets it to "now" (and snapshots `sla_target_hours` too) so `slaLabel` never silently comes back null for an overridden complaint. |
| `sla_paused_seconds` | integer | ✅ | A running total of time (in seconds) spent waiting on the citizen, e.g. in `NEEDS_MORE_EVIDENCE`. **This time is deducted from SLA calculation** so an officer is not penalized for delays caused by the citizen. Starts at 0. |
| `sla_paused_at` | datetime | ❌ | If the SLA clock is currently paused (the complaint is in `NEEDS_MORE_EVIDENCE` right now), this holds the timestamp when it paused. When the citizen resubmits, the app calculates `now - sla_paused_at`, adds it to `sla_paused_seconds`, and clears this field. |
| `created_at` | datetime | ✅ | When the complaint was filed. |
| `updated_at` | datetime | ✅ | Automatically refreshed on every change to this row. Used in the feed sort order and "last updated" display. |
| `resolved_at` | datetime | ❌ | Set when the officer marks the complaint `RESOLVED`. Used to compute resolution time for officer performance metrics. |
| `closed_at` | datetime | ❌ | Set when the complaint reaches `CLOSED`. Used for leaderboard resets, badge checks (Swift Reporter needs 3 closures in 7 days), and CSP crediting. |

### How SLA is calculated (plain English)
At serialization time, the code computes:
```
elapsed_seconds = (now - sla_started_at).total_seconds() - sla_paused_seconds
elapsed_hours   = elapsed_seconds / 3600
percentage_used = (elapsed_hours / sla_target_hours) × 100

if percentage_used < 80  → ON_TIME
if percentage_used < 100 → DELAYED
else                     → OVERDUE
```
Because the inputs (`sla_started_at`, `sla_paused_seconds`, `sla_target_hours`) are all stored, the label is always correct and never stale.

### Indexes
Six indexes cover every common access pattern:
- `(zone_id, status)` — the officer's complaint queue (filter by their zone + status)
- `citizen_id` — citizen's own dashboard (`GET /complaints/my`)
- `category_id` — analytics breakdowns by category
- `cluster_id` — looking up all complaints in a cluster
- `assigned_officer_id` — performance metrics per officer
- `status` — admin-level filtering

---

## Table 6: `complaint_evidence`

### What it is
Stores one row per uploaded photo. A complaint starts with one photo; if the officer requests more, the citizen uploads again and a second (or third) row is added. All photos are kept permanently.

### Why evidence is its own table
The charter makes evidence complex: it carries AI pre-screening results, an officer verdict, a reason, and a sequence number. Putting all of that as columns on `complaints` would mean either repeated columns (photo1_path, photo2_path, photo3_path) or lossy overwriting. A separate table handles any number of photos cleanly.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `complaint_id` | integer (FK) | ✅ | Which complaint this photo belongs to. |
| `sequence` | integer | ✅ | `1` for the original photo, `2` for the first resubmission, `3` for the second, and so on. The unique constraint on `(complaint_id, sequence)` makes sure no two photos can share a sequence number for the same complaint. |
| `file_path` | text | ✅ | The path to the photo file on the local filesystem (e.g. `/uploads/complaints/5023/1.jpg`). The image itself is never stored in the database — only the path. |
| `ai_screen_status` | `ai_screen_status` | ✅ | The AI screening state: `PENDING` (running), `DONE` (complete), or `UNAVAILABLE` (AI was down). Starts as `PENDING` the moment the photo is uploaded. This three-state field is important because `NULL` confidence is ambiguous — it could mean "not screened" or "AI was down." This Enum removes that ambiguity. |
| `ai_matches_category` | boolean | ❌ | `true` if the AI thinks the photo matches the chosen category, `false` if it suspects a mismatch. `NULL` until screening is `DONE`. |
| `ai_confidence` | float | ❌ | A number between 0 and 1 representing how confident the AI is. E.g. `0.87` means "87% confident this is a pothole." `NULL` if screening is not yet `DONE`. |
| `ai_note` | text | ❌ | A short plain-English sentence the AI generated to help the officer understand the hint. E.g. "Photo appears to show a road surface depression consistent with a pothole." Shown on the officer's evidence review screen. |
| `verdict` | `evidence_verdict` | ❌ | The officer's decision: `VALID`, `NEEDS_MORE_EVIDENCE`, or `REJECTED`. `NULL` until the officer submits their review. |
| `verdict_reason` | text | ❌ | The officer's written reason. **The application enforces this as mandatory when verdict is `NEEDS_MORE_EVIDENCE` or `REJECTED`.** The database allows `NULL` for the `VALID` case. |
| `reviewed_by` | integer (FK) | ❌ | The `users.id` of the officer who reviewed this evidence. If that officer's account is later deleted (rare), this becomes `NULL` rather than blocking the deletion. |
| `reviewed_at` | datetime | ❌ | When the officer submitted their verdict. |
| `created_at` | datetime | ✅ | When the photo was uploaded. |

### Example rows (for one complaint with a resubmission)

```
id: 1  complaint_id: 42  sequence: 1  file_path: /uploads/42/1.jpg
       ai_screen_status: DONE  ai_confidence: 0.81  ai_matches_category: true
       ai_note: "Looks like a pothole."
       verdict: NEEDS_MORE_EVIDENCE  verdict_reason: "Photo too dark to assess depth."
       reviewed_by: 7  reviewed_at: 2026-07-05 10:00

id: 2  complaint_id: 42  sequence: 2  file_path: /uploads/42/2.jpg
       ai_screen_status: DONE  ai_confidence: 0.94  ai_matches_category: true
       ai_note: "Clear pothole, confident match."
       verdict: VALID  verdict_reason: NULL
       reviewed_by: 7  reviewed_at: 2026-07-05 14:30
```

---

## Table 7: `status_history`

### What it is
A permanent, append-only log of every single status change a complaint goes through. Every time a complaint moves from one stage to another, a new row is inserted here — nothing is ever updated or deleted.

### Why append-only
If we only stored the current status on the `complaints` table, we'd know where a complaint is _now_ but have no way to answer "when did the officer accept it?", "how long was it waiting for evidence?", or "who closed it and why?" The history table makes the full journey auditable and transparent — the citizen can see every step, officers can see the trail, and admins can audit disputes.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `complaint_id` | integer (FK) | ✅ | Which complaint this history entry belongs to. |
| `from_status` | `complaint_status` | ❌ | The status the complaint was in **before** this change. `NULL` only for the very first entry (when a complaint is created at `SUBMITTED`, there is no previous status). |
| `to_status` | `complaint_status` | ✅ | The status the complaint moved **to**. |
| `actor_role` | `status_actor` | ✅ | Who made this change: `CITIZEN`, `OFFICER`, `ADMIN`, or `SYSTEM`. Maps to the API's `StatusActor` enum on `StatusHistoryEntry.changedByRole` — a separate, 4-value enum from the 3-value `Role` used on user accounts, since `SYSTEM` is never a valid account role. |
| `changed_by_user_id` | integer (FK) | ❌ | The `users.id` of the person who made the change. `NULL` when `actor_role = SYSTEM` (because automated actions have no human behind them). **The FK is `RESTRICT` on delete** — an officer or admin who has ever changed a complaint's status cannot be hard-deleted, protecting this audit trail the same way `complaint_notes.officer_id` protects note attribution. |
| `reason` | text | ❌ | The written reason accompanying this transition. Populated for: officer rejections, Unresolvable declarations, citizen disputes, and admin overrides. |
| `remark` | text | ❌ | An optional free-text remark, distinct from `reason` — e.g. the officer's closing note (`StatusUpdateRequest.note`) when marking `RESOLVED`. Maps 1:1 to `StatusHistoryEntry.remark` in the API. |
| `created_at` | datetime | ✅ | The exact timestamp of this transition. Combined with `from_status`/`to_status`, this gives a full timeline with durations. |

### Example history for a complaint

```
Row 1: from: NULL            → to: SUBMITTED          actor: CITIZEN   reason: —
Row 2: from: SUBMITTED       → to: EVIDENCE_UNDER_REVIEW  actor: OFFICER
Row 3: from: EVIDENCE_REVIEW → to: NEEDS_MORE_EVIDENCE    actor: OFFICER   reason: "Night-time, can't assess."
Row 4: from: NEEDS_MORE      → to: EVIDENCE_UNDER_REVIEW  actor: CITIZEN
Row 5: from: EVIDENCE_REVIEW → to: UNDER_REVIEW            actor: OFFICER
Row 6: from: UNDER_REVIEW    → to: IN_PROGRESS             actor: OFFICER
Row 7: from: IN_PROGRESS     → to: UNDER_RESOLUTION        actor: OFFICER
Row 8: from: UNDER_RESOLUTION → to: RESOLVED              actor: OFFICER
Row 9: from: RESOLVED        → to: CLOSED                  actor: CITIZEN
```

If the citizen disputes instead of confirming at Row 9, the officer picks the complaint back up the same way they picked up any other queued complaint — via `PATCH /officer/complaints/{id}/status`, not automatically:

```
Row 9: from: RESOLVED        → to: REOPENED                actor: CITIZEN   reason: "Pothole is still there."
Row 10: from: REOPENED       → to: IN_PROGRESS              actor: OFFICER
```

---

## Table 8: `complaint_notes`

### What it is
Progress notes posted by officers while they are working on a complaint. These notes are visible to the citizen on their complaint detail page so they know what is happening without making a phone call.

### Why permanent
Notes are part of the accountability record. An officer cannot edit or delete a note they posted — it becomes part of the permanent trail that shows the citizen (and admins) exactly what was communicated. This is enforced at the application level.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `complaint_id` | integer (FK) | ✅ | Which complaint this note is attached to. |
| `officer_id` | integer (FK) | ✅ | The officer who posted it. The citizen sees the officer's `id` (their public identifier), **never their full name.** The FK is `RESTRICT` on delete — you cannot delete an officer account that has posted notes, protecting the audit trail. |
| `note_text` | varchar(500) | ✅ | The note itself. Maximum 500 characters. Cannot be empty. |
| `created_at` | datetime | ✅ | When the note was posted. Notes are displayed chronologically, newest last. |

### Example rows

```
id: 1  complaint_id: 42  officer_id: 7
       note_text: "Inspected the site. Confirmed pothole. Assigned repair crew."
       created_at: 2026-07-06 09:15

id: 2  complaint_id: 42  officer_id: 7
       note_text: "Repair crew on site. Work expected to complete by end of day."
       created_at: 2026-07-06 14:00
```

---

## Table 9: `complaint_upvotes`

### What it is
Records which citizen upvoted which complaint. One row = one citizen saying "this affects me too."

### Why upvotes need their own table
Two rules govern upvotes: a citizen can only upvote a given complaint **once**, and they cannot upvote their **own** complaint. A separate table with a unique constraint on `(complaint_id, citizen_id)` enforces the one-upvote rule at the database level — no application-level check can accidentally miss it. The no-self-upvote rule is enforced by the application (it compares `citizen_id` against the complaint's `citizen_id` before inserting).

### What upvotes drive
- **Severity score:** each upvote adds +1 to `complaints.severity_score` (the application updates that column).
- **CSP for the reporter:** each new upvote triggers a `+5 UPVOTE_RECEIVED` row in `points_ledger` for the complaint's original filer.
- **Feed display:** `upvoteCount` on the feed = `SELECT COUNT(*) FROM complaint_upvotes WHERE complaint_id = ?`.
- **hasUpvoted flag:** `SELECT 1 FROM complaint_upvotes WHERE complaint_id = ? AND citizen_id = ?` tells the frontend to show the upvote button as already-pressed.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `complaint_id` | integer (FK) | ✅ | The complaint being upvoted. |
| `citizen_id` | integer (FK) | ✅ | The citizen who upvoted. |
| `created_at` | datetime | ✅ | When the upvote was cast. |

### Constraints
- **UNIQUE `(complaint_id, citizen_id)`** — the enforcement that one citizen cannot upvote the same complaint twice. If they try, the database throws an integrity error before any app code runs.

---

## Part 3 — Gamification

These three tables handle the entire points and badges system. They follow the "ledger" pattern — all history is kept, nothing is overwritten.

---

## Table 10: `points_ledger`

### What it is
Every CSP (Community Service Points) change for every citizen, recorded as individual rows. Think of it like a bank statement: every deposit and every penalty is a separate line item.

### Why not just store the total
Storing a single `total_points` column on `users` would be simpler. But it has a fatal flaw: if a bug, a race condition, or a future code change incorrectly adds or subtracts, the error is permanent and silent — the number is wrong and there is no way to check. With a ledger:
- The total is `SUM(points_change)` — always correct and re-computable.
- The monthly total is `SUM(points_change) WHERE created_at >= start_of_month` — no reset logic needed.
- An audit of "why does this citizen have 245 points?" is fully answerable.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `citizen_id` | integer (FK) | ✅ | Who earned or lost these points. |
| `complaint_id` | integer (FK) | ❌ | The complaint that triggered this change. `NULL` for the `FIRST_COMPLAINT` bonus (no specific complaint caused it — it fires on the first submission). If a complaint is deleted (unusual), this becomes `NULL` but the points row survives, protecting the citizen's history. |
| `points_change` | integer | ✅ | **Signed integer.** Positive for gains (`+50`, `+10`, `+15`, `+5`), negative for penalties (`-20`). |
| `reason` | `points_reason` | ✅ | One of the 6 fixed reasons (Enum). Using a code rather than free text means the app can reliably query "how many penalty entries happened this month?" |
| `created_at` | datetime | ✅ | When the change occurred. Used for monthly vs lifetime breakdowns. |

### Example ledger for one citizen

```
citizen_id: 5  points_change: +10  reason: FIRST_COMPLAINT      complaint_id: 101  (filed first complaint)
citizen_id: 5  points_change: +5   reason: UPVOTE_RECEIVED       complaint_id: 101  (someone upvoted their complaint)
citizen_id: 5  points_change: +5   reason: UPVOTE_RECEIVED       complaint_id: 101  (another upvote)
citizen_id: 5  points_change: +50  reason: COMPLAINT_CLOSED      complaint_id: 101  (complaint confirmed fixed)
citizen_id: 5  points_change: +15  reason: ON_TIME_BONUS         complaint_id: 101  (resolved within SLA)
citizen_id: 5  points_change: -20  reason: REJECTED_PENALTY      complaint_id: 103  (second complaint was rejected)
```
Lifetime total: `10 + 5 + 5 + 50 + 15 − 20 = 65 CSP`

### Example: two citizens in the same cluster

Complaints 101 (citizen 5, filed first) and 102 (citizen 6, filed second) are both in cluster 30. Citizen 6 happens to *confirm* first — reporting order does not decide the reward, confirmation order does:

```
citizen_id: 6  points_change: +50  reason: COMPLAINT_CLOSED      complaint_id: 102  (first in cluster 30 to confirm — reward_granted flips to true)
citizen_id: 5  points_change: +15  reason: ON_TIME_BONUS         complaint_id: 101  (their own complaint met its own SLA)
citizen_id: 5  points_change: +10  reason: CLUSTER_MEMBER_CLOSED complaint_id: 101  (confirms afterward — cluster 30's +50 is already spent)
```
Citizen 5 still earns the on-time bonus even though they only got the consolation reward for `COMPLAINT_CLOSED` — the two are independent.

---

## Table 11: `badges`

### What it is
The catalog of the 6 badges that can be earned. This table is seeded once at setup and never changes during normal operation.

### Why criteria is stored in the table (not in code)
The old approach would hardcode badge logic directly in application code with `if` statements. That works for simple point-threshold badges but breaks down for event-based badges like "first complaint" or time-window badges like "3 complaints closed in 7 days." By storing `criteria_type`, `criteria_value`, and `criteria_count` in the database, all six badges are handled by a single, generalized awarding engine. Adding a new badge in future — including another time-window badge with a different count — is a row insert, not a code change.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. Referenced by `citizen_badges.badge_id`. |
| `badge_code` | `badge_code` | ✅ | The unique code for this badge (Enum). Ensures there is exactly one row per badge. |
| `badge_name` | varchar(80) | ✅ | Display name shown to citizens, e.g. "Street Guardian". |
| `description` | text | ❌ | What the badge means, e.g. "Consistently holding the city accountable." Shown in the UI. |
| `criteria_type` | `badge_criteria_type` | ✅ | How this badge is earned (see the Enum above). Makes the award logic data-driven. |
| `criteria_value` | integer | ❌ | The threshold number for criteria types that need one. For `CLOSED_WITHIN_DAYS` this is the day-window (see `criteria_count` for the count). `NULL` for `FIRST_COMPLAINT` and `ZONE_RANK_ONE` (no count needed). |
| `criteria_count` | integer | ❌ | Only used by `CLOSED_WITHIN_DAYS` — the number of closures required within `criteria_value` days (e.g. 3). `NULL` for every other `criteria_type`. Without this column, `CLOSED_WITHIN_DAYS` couldn't actually be data-driven: the count would have to be a hardcoded constant in application code, contradicting the point of this table. |
| `created_at` | datetime | ✅ | When this badge was seeded. |

### The 6 seeded rows

```
badge_code: KARTAVYA_INITIATE   criteria_type: FIRST_COMPLAINT    criteria_value: NULL  criteria_count: NULL
badge_code: STREET_GUARDIAN     criteria_type: COMPLAINTS_CLOSED  criteria_value: 5     criteria_count: NULL
badge_code: ZONE_CHAMPION       criteria_type: ZONE_RANK_ONE       criteria_value: NULL  criteria_count: NULL
badge_code: CENTURY_REFORMER    criteria_type: LIFETIME_POINTS     criteria_value: 100   criteria_count: NULL
badge_code: CIVIC_HERO          criteria_type: LIFETIME_POINTS     criteria_value: 500   criteria_count: NULL
badge_code: SWIFT_REPORTER      criteria_type: CLOSED_WITHIN_DAYS  criteria_value: 7     criteria_count: 3
```

---

## Table 12: `citizen_badges`

### What it is
A record of which citizen has earned which badge, and when. One row = one citizen earned one badge.

### Why it is separate from `badges`
The `badges` table is a catalog (what badges exist). `citizen_badges` is the earned record (who has what). This is the standard "many-to-many" pattern: one citizen can earn many badges; one badge can be earned by many citizens.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. |
| `citizen_id` | integer (FK) | ✅ | The citizen who earned the badge. |
| `badge_id` | integer (FK) | ✅ | Which badge they earned. |
| `earned_at` | datetime | ✅ | The exact moment the badge was awarded. Shown in the citizen's badge list. |

### The critical constraint
**UNIQUE `(citizen_id, badge_id)`** — enforces the charter rule that a badge is awarded to any given citizen **at most once**. Without this, a retry or a race condition could award the same badge twice. With this constraint, the second insert fails at the database level before any application logic can act on it.

---

## Part 4 — AI Reports & System Configuration

Two small but important tables: one for the AI-generated zone health reports, and one for admin-controlled system settings.

---

## Table 13: `ai_zone_reports`

### What it is
Stores the AI-generated plain-English summaries of a zone's civic health. When an admin clicks "Generate Report" for a zone, a new row is created immediately (with status `PENDING`); the AI processing happens in the background; and the row is updated to `READY` when done.

### Why reports need to be persisted
The API contract requires that the admin can **view a generated report again without re-running the AI.** This was a deliberate design decision because the local AI model (LM Studio / llama.cpp) can be slow. If the report were generated fresh every time the admin opened the page, it would be unusable. Storing the result means one expensive generation, then instant re-reads.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Primary key. Also serves as the report ID returned in the `POST /admin/zones/{zoneId}/ai-report` response. |
| `zone_id` | integer (FK) | ✅ | Which zone this report covers. |
| `requested_by` | integer (FK) | ❌ | The admin who triggered the generation. If that admin account is later deleted, this becomes `NULL` but the report is kept. |
| `status` | `ai_report_status` | ✅ | `PENDING` (just triggered), `READY` (done), or `FAILED` (AI was unavailable). **Starts as `PENDING`.** The frontend polls or refreshes to check when it becomes `READY`. |
| `ai_available` | boolean | ✅ | `true` if the AI model was reachable when generation was attempted. `false` (with status `FAILED`) if it was down — so the admin sees a clear "AI unavailable" message rather than just a blank screen. |
| `summary` | text | ❌ | The main paragraph: what's happening in this zone overall. `NULL` until `status = READY`. |
| `trends` | text | ❌ | A paragraph on trends: are complaints going up or down, which categories are spiking? |
| `hotspots` | text | ❌ | A paragraph on problem areas: which sub-areas or complaint types are clustered. |
| `suggestions` | text | ❌ | The AI's actionable suggestions: "Consider increasing street-light maintenance frequency in Sector 4." |
| `generated_at` | datetime | ❌ | Set when `status` moves to `READY` or `FAILED`. `NULL` while still `PENDING`. |
| `created_at` | datetime | ✅ | When the generation was triggered. |

### How the API uses this table
- `POST /admin/zones/{zoneId}/ai-report` → inserts a new row with `status = PENDING`, returns the row immediately (`202 Accepted`).
- Background job fills in the text columns and sets `status = READY`.
- `GET /admin/zones/{zoneId}/ai-report` → queries `SELECT * FROM ai_zone_reports WHERE zone_id = ? ORDER BY created_at DESC LIMIT 1` and returns whatever is there (might still be `PENDING`).

---

## Table 14: `app_settings`

### What it is
A single-row configuration table. It holds system-wide settings that admins can change through the API without a code deployment.

### Why it is a table
The alternative is to hardcode settings as constants in the Flask application. But the charter explicitly says the auto-close timeout should be "configurable by admin." If it's hardcoded, an admin cannot change it without a developer, a code change, and a redeploy. Storing it here means `PATCH /admin/settings` just updates this row, and the next time the auto-close job runs, it reads the new value.

### Columns

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✅ | Always `1`. This is a **single-row table** — there is only ever one settings row. The application inserts it during initial setup and only ever `UPDATE`s it, never inserts a second row. |
| `auto_close_timeout_hours` | integer | ✅ | How many hours a complaint can stay in the `RESOLVED` state without citizen action before the system auto-closes it. **Default: 168 hours (7 days).** The auto-close background job reads this value on each run. |
| `updated_by` | integer (FK) | ❌ | The admin who last changed the settings. `NULL` if not yet changed from default. If that admin is deleted, becomes `NULL` rather than blocking deletion. |
| `updated_at` | datetime | ✅ | The last time settings were updated. |

---

## Summary: How the Tables Connect

Here is the full picture of what connects to what, in plain English.

```
zones ──────────────────────────────────────────────────────────────────┐
  │                                                                       │
  ├── users (officers and citizens belong to a zone)                     │
  │                                                                       │
  ├── complaints (every complaint is in a zone)                          │
  │     │                                                                 │
  │     ├── complaint_clusters (linked if nearby same-type exist)         │
  │     │                                                                 │
  │     ├── complaint_evidence (one or more photos per complaint)         │
  │     │                                                                 │
  │     ├── status_history (append-only log of every stage change)        │
  │     │                                                                 │
  │     ├── complaint_notes (officer progress notes, visible to citizen)  │
  │     │                                                                 │
  │     └── complaint_upvotes (one row per citizen-upvote, unique)        │
  │                                                                       │
  └── ai_zone_reports (AI reports are per zone)                          │
                                                                         │
complaint_categories ────────────────────────────────────────────────────┘
  │
  └── complaints (category decides SLA and routing)

users
  │
  ├── points_ledger (every CSP change, append-only, no stored total)
  │
  └── citizen_badges (which badges a citizen has earned, unique constraint)
        │
        └── badges (the catalog of 6 badge types with criteria)

app_settings (single-row; holds the auto-close timeout)
```

---

## Appendix: Delete Behavior Reference

When a row is deleted, the database needs to know what to do with rows in other tables that reference it. There are three strategies used in this schema, chosen deliberately per relationship.

| Strategy | What it does | When we use it |
|---|---|---|
| `RESTRICT` | **Block the deletion.** You cannot delete the parent while children exist. | Used where deleting would damage irreplaceable history: a user with filed complaints, an officer with posted notes, a badge that has been earned. |
| `SET NULL` | **Allow the deletion** but clear the FK column to `NULL` in child rows. | Used for actor references where the record should survive but the specific "who did this" link can be dropped: who reviewed a photo, who changed a status, who requested an AI report. |
| `CASCADE` | **Delete the children too.** When the parent goes, all its children go with it. | Used for per-user or per-complaint artifacts where the children are meaningless without the parent: a user's upvotes, a user's badges, a complaint's full detail (evidence, history, notes). |

The practical implication: **you cannot hard-delete a user who has ever filed a complaint.** The database will block it. The intended flow is `PATCH /admin/users/{userId}` with `active: false` — deactivation, not deletion — which the API documentation explicitly steers admins toward.