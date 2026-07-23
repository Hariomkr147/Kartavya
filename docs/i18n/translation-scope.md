# Translation scope decision

Scope confirmed: all three role workflows (citizen, officer, admin) are in — which also pulls in every shared `components/ui/*` and `components/complaint/*` component, since all three roles compose them. No admin-only "back office, skip it" carve-out.

Rule applied: translate a string if a citizen, officer, or admin reads/hears it while doing their job in the app. Everything from the scan (`hardcoded-strings.json`, 558 candidates) falls into this **except** the 9 rows below.

## Excluded (9 of 558)

| File:Line | Text | Why excluded |
|---|---|---|
| `components/layout/AppShell.tsx:344` | `Kartavya` | Brand/product name — never translated. |
| `pages/public/LandingPage.tsx:101` | `Kartavya` | Brand/product name. |
| `pages/public/LoginPage.tsx:50` | `Kartavya` | Brand/product name. |
| `pages/public/RegisterPage.tsx:70` | `Kartavya` | Brand/product name. |
| `components/ui/MapPicker.tsx:99` | `&copy; OpenStreetMap contributors` | Legal attribution text — OSM's terms expect this exact copy, not a translation. |
| `pages/admin/ZonesPage.tsx:287` | `Ward 12 – North` | It's a placeholder *example* of the naming format, not prose being read. |
| `pages/public/LoginPage.tsx:100` | `Demo mode — see the browser console for sample logins.` | Dev/demo-only helper text (mock-backend artifact), not real product copy. |
| `components/ui/Dropdown.tsx:35` | `… must be used within a <Dropdown>` | Thrown for a programmer misusing the component — never reaches an end user. |
| `services/http.ts:73` | `Bearer …` | HTTP `Authorization` header value, not UI text. |

Everything else the scanner found — **549 strings across 40 files** — is real in-workflow UI copy: page headings, buttons, empty states, form labels/placeholders/hints, confirmation dialogs, toasts, aria-labels, status/dispute/override copy, etc. Translate all of it.

## Important: the scan undercounts — enum label maps

The scanner only looked at JSX (text nodes + attributes). It missed hardcoded strings living in **`Record<Enum, string>` label maps**, which is exactly where the schema's derived-not-stored enums (`severity_label`, `sla_label`, complaint status) get their display text. These need translating too, and there are only two files to touch plus one duplication to be aware of:

| File | What | Notes |
|---|---|---|
| `components/ui/pills.tsx` | `STATUS_LABELS` (11 values), `SEVERITY_LABELS` (4), `SLA_LABELS` (3) | The canonical label maps for `ComplaintStatus`, `SeverityLabel`, `SlaLabel`. Everything renders through here via `<StatusPill>`/`<SeverityPill>`/`<SlaPill>`. |
| `components/complaint/StatusTimeline.tsx` | `ACTOR_LABEL` (4: Citizen/Officer/Admin/System) | Used in the status history timeline. |
| `pages/citizen/MyComplaintsPage.tsx` | `STATUS_LABELS` (11) | **Duplicate** of the one in `pills.tsx` (same keys/values), used for a filter dropdown. Pre-existing duplication, not an i18n artifact — worth collapsing to one shared export regardless of i18n, otherwise every locale has to translate the same 11 strings twice and they can drift. |

Category names (`Complaint.category.name`) are **not** in scope — they come from the API (`/categories`), so translating them would be a backend i18n concern, out of bounds for this frontend-only effort.

## What this means for the tooling setup

- ~549 JSX strings + ~30 enum-map strings ≈ **580 real translation keys**, organized by the namespaces I'd suggest earlier (roughly one per page/feature area, plus a `common` namespace for shared components and the enum label maps).
- The `pills.tsx` duplication should get resolved as part of this work (export the map, import it in `MyComplaintsPage.tsx`) — small cleanup, saves real translation effort per locale.
