# Hardcoded UI strings scan

Scanned 137 files under `frontend/src` (excluding `mocks/`, `types/`, tests, generated API types).

**558 candidate hardcoded, user-facing strings found across 40 files.**

This is a heuristic AST scan (TypeScript compiler API) — it looks for JSX text nodes, text-bearing JSX attributes (`placeholder`, `title`, `label`, `alt`, `aria-label`, `description`, etc.), string literals in ternaries/template literals, and toast/alert call arguments. It excludes className/style/routing/technical attributes and CSS-class-shaped strings. Expect a small amount of remaining noise (e.g. internal state tokens) — treat this as a punch list to eyeball, not a guaranteed-precise inventory.

## Counts by file

| File | Count |
|---|---|
| `pages/admin/ZonesPage.tsx` | 52 |
| `pages/citizen/FileComplaintPage.tsx` | 45 |
| `pages/officer/ComplaintDetailPage.tsx` | 45 |
| `pages/admin/UsersPage.tsx` | 40 |
| `pages/admin/ComplaintDetailPage.tsx` | 32 |
| `pages/admin/OfficersPage.tsx` | 32 |
| `pages/citizen/ComplaintDetailPage.tsx` | 24 |
| `pages/officer/QueuePage.tsx` | 22 |
| `pages/citizen/DashboardPage.tsx` | 20 |
| `pages/officer/ClusterDetailPage.tsx` | 19 |
| `pages/admin/ComplaintsPage.tsx` | 18 |
| `pages/admin/DashboardPage.tsx` | 18 |
| `pages/citizen/GamificationPage.tsx` | 18 |
| `pages/officer/DashboardPage.tsx` | 18 |
| `pages/account/AccountPage.tsx` | 17 |
| `pages/citizen/MyComplaintsPage.tsx` | 17 |
| `components/complaint/BatchStatusModal.tsx` | 15 |
| `pages/public/LandingPage.tsx` | 14 |
| `pages/public/RegisterPage.tsx` | 12 |
| `components/layout/AppShell.tsx` | 10 |
| `pages/citizen/FeedPage.tsx` | 9 |
| `pages/public/LoginPage.tsx` | 9 |
| `components/ui/FileDropzone.tsx` | 7 |
| `components/complaint/EvidenceGallery.tsx` | 6 |
| `pages/officer/ClustersPage.tsx` | 6 |
| `pages/admin/DisputesPage.tsx` | 5 |
| `components/complaint/StatusTimeline.tsx` | 3 |
| `components/ui/DatePicker.tsx` | 3 |
| `components/ui/MapPicker.tsx` | 3 |
| `components/ui/Pagination.tsx` | 3 |
| `pages/public/ForbiddenPage.tsx` | 3 |
| `pages/public/NotFoundPage.tsx` | 3 |
| `components/ui/ThemeToggle.tsx` | 2 |
| `components/ui/Toast.tsx` | 2 |
| `components/FullPageSpinner.tsx` | 1 |
| `components/complaint/TimelineSidebar.tsx` | 1 |
| `components/ui/Dropdown.tsx` | 1 |
| `components/ui/Modal.tsx` | 1 |
| `components/ui/Stepper.tsx` | 1 |
| `services/http.ts` | 1 |

## Counts by kind

| Kind | Count |
|---|---|
| `jsx-text` | 360 |
| `jsx-attr:label` | 30 |
| `conditional-string` | 29 |
| `jsx-attr:title` | 28 |
| `template-literal` | 23 |
| `jsx-attr:description` | 22 |
| `jsx-attr:aria-label` | 18 |
| `jsx-attr:placeholder` | 14 |
| `conditional-string:title` | 6 |
| `template-literal:title` | 4 |
| `conditional-string:hint` | 4 |
| `conditional-string:description` | 4 |
| `template-literal:description` | 3 |
| `jsx-attr-maybe:hint` | 3 |
| `template-literal:alt` | 2 |
| `conditional-string:aria-label` | 2 |
| `jsx-attr:alt` | 2 |
| `template-literal:aria-label` | 2 |
| `jsx-attr-maybe:attribution` | 1 |
| `template-literal:label` | 1 |

---

## Details by file

### `components/FullPageSpinner.tsx` (1)

| Line | Kind | Text |
|---|---|---|
| 8 | `jsx-attr:aria-label` | Loading |

### `components/complaint/BatchStatusModal.tsx` (15)

| Line | Kind | Text |
|---|---|---|
| 86 | `conditional-string` | Something went wrong. Please try again. |
| 95 | `conditional-string:title` | Batch update results |
| 95 | `conditional-string:title` | Batch update status |
| 99 | `template-literal:description` | Apply the same status change to … complaint…. |
| 103 | `jsx-text` | Done |
| 107 | `jsx-text` | Cancel |
| 110 | `jsx-text` | Apply to |
| 110 | `jsx-text` | complaint |
| 119 | `jsx-text` | succeeded |
| 120 | `template-literal` | · … failed |
| 159 | `jsx-text` | Target status |
| 172 | `jsx-text` | Reason |
| 178 | `jsx-attr:placeholder` | Why is this batch moving to this status? |
| 184 | `jsx-text` | Closing note (optional) |
| 189 | `jsx-attr:placeholder` | Applied to every complaint in this batch. |

### `components/complaint/EvidenceGallery.tsx` (6)

| Line | Kind | Text |
|---|---|---|
| 40 | `template-literal:alt` | Evidence photo … |
| 51 | `jsx-text` | % match |
| 57 | `jsx-text` | Analyzing… |
| 63 | `jsx-text` | AI unavailable |
| 70 | `jsx-text` | Photo # |
| 92 | `jsx-text` | AI screening was unavailable for this photo — an officer will review it directly. |

### `components/complaint/StatusTimeline.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 77 | `jsx-text` | Officer # |
| 93 | `template-literal` | Officer #… |
| 114 | `jsx-text` | Current |

### `components/complaint/TimelineSidebar.tsx` (1)

| Line | Kind | Text |
|---|---|---|
| 29 | `jsx-text` | Status history |

### `components/layout/AppShell.tsx` (10)

| Line | Kind | Text |
|---|---|---|
| 186 | `conditional-string:aria-label` | Expand sidebar |
| 186 | `conditional-string:aria-label` | Collapse sidebar |
| 195 | `jsx-text` | Collapse |
| 214 | `jsx-attr:aria-label` | Close navigation |
| 231 | `jsx-attr:aria-label` | Open navigation |
| 246 | `jsx-attr:aria-label` | Breadcrumb |
| 290 | `jsx-attr:aria-label` | Account menu |
| 306 | `jsx-text` | Account |
| 309 | `jsx-text` | Log out |
| 344 | `jsx-text` | Kartavya |

### `components/ui/DatePicker.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 137 | `jsx-attr:aria-label` | Choose date |
| 144 | `jsx-attr:aria-label` | Previous month |
| 155 | `jsx-attr:aria-label` | Next month |

### `components/ui/Dropdown.tsx` (1)

| Line | Kind | Text |
|---|---|---|
| 35 | `template-literal` | … must be used within a <Dropdown> |

### `components/ui/FileDropzone.tsx` (7)

| Line | Kind | Text |
|---|---|---|
| 44 | `template-literal` | Photo must be under … MB. |
| 101 | `template-literal` | Add another photo (…/…) |
| 102 | `conditional-string` | Drop a photo here, or click to browse |
| 105 | `jsx-text` | JPEG or PNG, up to |
| 106 | `template-literal` | · up to … photos |
| 136 | `jsx-attr:alt` | Selected evidence preview |
| 141 | `jsx-attr:aria-label` | Remove photo |

### `components/ui/MapPicker.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 60 | `jsx-attr:title` | Use my current location |
| 61 | `jsx-attr:aria-label` | Use my current location |
| 99 | `jsx-attr-maybe:attribution` | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors |

### `components/ui/Modal.tsx` (1)

| Line | Kind | Text |
|---|---|---|
| 115 | `jsx-attr:aria-label` | Close dialog |

### `components/ui/Pagination.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 29 | `jsx-attr:aria-label` | Pagination |
| 40 | `jsx-attr:aria-label` | Previous page |
| 71 | `jsx-attr:aria-label` | Next page |

### `components/ui/Stepper.tsx` (1)

| Line | Kind | Text |
|---|---|---|
| 13 | `jsx-attr:aria-label` | Progress |

### `components/ui/ThemeToggle.tsx` (2)

| Line | Kind | Text |
|---|---|---|
| 21 | `template-literal:title` | … — click to switch to … |
| 22 | `template-literal:aria-label` | …. Click to switch to …. |

### `components/ui/Toast.tsx` (2)

| Line | Kind | Text |
|---|---|---|
| 72 | `jsx-attr:aria-label` | Notifications |
| 95 | `jsx-attr:aria-label` | Dismiss notification |

### `pages/account/AccountPage.tsx` (17)

| Line | Kind | Text |
|---|---|---|
| 120 | `jsx-text` | Account |
| 122 | `jsx-text` | Manage your profile and password. |
| 129 | `jsx-text` | Profile |
| 138 | `jsx-text` | Full name |
| 148 | `jsx-text` | Display name |
| 151 | `jsx-attr-maybe:hint` | Shown publicly on the feed and leaderboard. Leave blank to use a masked placeholder instead. |
| 158 | `jsx-text` | Email |
| 175 | `jsx-text` | Home zone |
| 196 | `jsx-text` | Assigned zone |
| 202 | `jsx-text` | Your zone is a work assignment — ask an admin to reassign it. |
| 208 | `jsx-text` | Save changes |
| 217 | `jsx-text` | Change password |
| 227 | `jsx-text` | Current password |
| 239 | `jsx-text` | New password |
| 245 | `conditional-string:hint` | At least 8 characters. |
| 252 | `jsx-text` | Confirm new password |
| 263 | `jsx-text` | Update password |

### `pages/admin/ComplaintDetailPage.tsx` (32)

| Line | Kind | Text |
|---|---|---|
| 91 | `jsx-attr:title` | Complaint not found |
| 94 | `jsx-text` | Back to Complaints |
| 125 | `conditional-string` | Something went wrong. Please try again. |
| 143 | `conditional-string` | Dispute upheld |
| 143 | `conditional-string` | Dispute rejected |
| 146 | `conditional-string` | Sent back to the officer as In Progress. |
| 147 | `conditional-string` | The original resolution stands; complaint closed. |
| 156 | `conditional-string` | Something went wrong. Please try again. |
| 171 | `jsx-text` | Complaints |
| 188 | `jsx-text` | · filed |
| 205 | `jsx-text` | Reporter: |
| 209 | `template-literal` | · public handle "…" |
| 216 | `jsx-text` | Assigned: |
| 219 | `template-literal` | Officer #… |
| 231 | `jsx-text` | Evidence |
| 242 | `jsx-text` | Rule on this dispute |
| 246 | `jsx-text` | The citizen disputed the resolution. Uphold to send it back to the officer as In Progress, or reject to keep the original resolution and close it. Neither outcome credits points. |
| 261 | `jsx-text` | Uphold dispute |
| 268 | `jsx-text` | Reject dispute |
| 273 | `jsx-text` | Reason |
| 279 | `jsx-attr:placeholder` | Your justification, recorded on the status history. |
| 289 | `jsx-text` | Submit ruling |
| 297 | `jsx-text` | Override |
| 300 | `jsx-text` | Correct the category, force a status, or reassign the zone. Every change here is recorded in the status history with you as the actor. |
| 310 | `jsx-text` | Status |
| 322 | `jsx-text` | Category |
| 334 | `jsx-text` | Zone |
| 348 | `jsx-text` | The SLA timer hasn't started on this complaint yet — forcing it to |
| 349 | `jsx-text` | will backfill the timer to start now, using the category's current SLA target. |
| 354 | `jsx-text` | Reason (recommended) |
| 359 | `jsx-attr:placeholder` | Why is this override being made? |
| 369 | `jsx-text` | Apply override |

### `pages/admin/ComplaintsPage.tsx` (18)

| Line | Kind | Text |
|---|---|---|
| 127 | `jsx-text` | Complaints |
| 130 | `jsx-text` | Every complaint across every zone, with full filtering. |
| 135 | `jsx-text` | Export CSV |
| 142 | `jsx-text` | Zone |
| 157 | `jsx-text` | Category |
| 161 | `jsx-attr:placeholder` | All categories |
| 200 | `jsx-text` | From |
| 212 | `jsx-text` | To |
| 226 | `jsx-text` | Status |
| 255 | `jsx-attr:title` | No complaints match |
| 256 | `jsx-attr:description` | Try loosening a filter. |
| 264 | `jsx-text` | Category |
| 265 | `jsx-text` | Zone |
| 266 | `jsx-text` | Status |
| 267 | `jsx-text` | Severity |
| 269 | `jsx-text` | Officer |
| 270 | `jsx-text` | Filed |
| 302 | `template-literal` | Officer #… |

### `pages/admin/DashboardPage.tsx` (18)

| Line | Kind | Text |
|---|---|---|
| 68 | `jsx-text` | Admin Dashboard |
| 71 | `jsx-text` | Live cross-zone overview — every number reflects the current database state. |
| 88 | `jsx-attr:label` | Zones |
| 89 | `jsx-attr:label` | Pending complaints |
| 92 | `jsx-attr:label` | Overdue |
| 98 | `jsx-attr:label` | Resolved (mo.) |
| 104 | `jsx-attr:label` | Avg. resolution |
| 118 | `jsx-text` | Complaint load by zone |
| 161 | `jsx-text` | No zones have been created yet. |
| 175 | `jsx-text` | Zone |
| 176 | `jsx-text` | Pending |
| 177 | `jsx-text` | Overdue |
| 178 | `jsx-text` | Resolved (mo.) |
| 179 | `jsx-text` | Avg. resolution |
| 180 | `jsx-text` | Severity heat |
| 181 | `jsx-text` | Top citizen |
| 237 | `template-literal` | …`} (… CSP) |
| 237 | `template-literal` | Citizen #… |

### `pages/admin/DisputesPage.tsx` (5)

| Line | Kind | Text |
|---|---|---|
| 29 | `jsx-text` | Dispute Queue |
| 32 | `jsx-text` | Complaints a citizen disputed after resolution — each is waiting for your ruling. |
| 45 | `jsx-attr:title` | No pending disputes |
| 46 | `jsx-attr:description` | When a citizen disputes a resolution, it'll show up here for your ruling. |
| 70 | `jsx-text` | · disputed |

### `pages/admin/OfficersPage.tsx` (32)

| Line | Kind | Text |
|---|---|---|
| 29 | `jsx-text` | Officers |
| 32 | `jsx-text` | Performance scorecards and AI-generated zone health reports. |
| 38 | `jsx-text` | Officer Performance |
| 39 | `jsx-text` | AI Zone Reports |
| 66 | `jsx-text` | Officer |
| 79 | `jsx-text` | Period |
| 96 | `jsx-attr:title` | Pick an officer |
| 97 | `jsx-attr:description` | Their scorecard will appear here. |
| 116 | `jsx-attr:label` | Total handled |
| 117 | `jsx-attr:label` | On time |
| 118 | `jsx-attr:label` | Delayed |
| 119 | `jsx-attr:label` | Overdue |
| 122 | `jsx-text` | complaint |
| 123 | `jsx-text` | marked Unresolvable are excluded from the figures above. |
| 128 | `jsx-text` | Evidence review |
| 130 | `jsx-attr:label` | Valid |
| 132 | `jsx-attr:label` | Needed more |
| 136 | `jsx-attr:label` | Rejected |
| 140 | `jsx-text` | Accept rate: |
| 147 | `jsx-attr:label` | Avg. resolution time |
| 183 | `jsx-text` | Zone |
| 198 | `jsx-attr:title` | Pick a zone |
| 199 | `jsx-attr:description` | Generate or view its latest AI health report. |
| 210 | `jsx-text` | AI health report |
| 214 | `conditional-string` | Generate report |
| 220 | `jsx-text` | No report has been generated for this zone yet. |
| 225 | `jsx-text` | Generating — this usually takes a few seconds. |
| 230 | `jsx-text` | The AI model was unavailable when this report was requested. The rest of the dashboard is unaffected — try generating again shortly. |
| 235 | `jsx-attr:title` | Summary |
| 236 | `jsx-attr:title` | Trends |
| 237 | `jsx-attr:title` | Hotspots |
| 238 | `jsx-attr:title` | Suggestions |

### `pages/admin/UsersPage.tsx` (40)

| Line | Kind | Text |
|---|---|---|
| 127 | `conditional-string` | Something went wrong. Please try again. |
| 136 | `jsx-text` | Users |
| 138 | `jsx-text` | Every citizen, officer, and admin account. |
| 149 | `jsx-text` | Create account |
| 155 | `jsx-text` | Role |
| 172 | `jsx-text` | Zone |
| 187 | `jsx-text` | Status |
| 213 | `jsx-attr:title` | No accounts match |
| 214 | `jsx-attr:description` | Try a different filter. |
| 222 | `jsx-text` | Name |
| 223 | `jsx-text` | Email |
| 224 | `jsx-text` | Role |
| 225 | `jsx-text` | Zone |
| 226 | `jsx-text` | Status |
| 227 | `jsx-text` | Actions |
| 256 | `jsx-text` | Edit |
| 268 | `jsx-text` | Delete |
| 292 | `jsx-attr:title` | Create account |
| 293 | `jsx-attr:description` | Admins cannot be created here — only citizens and officers. |
| 297 | `jsx-text` | Cancel |
| 303 | `jsx-text` | Create |
| 311 | `jsx-text` | Role |
| 332 | `jsx-text` | Full name |
| 338 | `jsx-text` | Email |
| 349 | `jsx-text` | Password |
| 354 | `conditional-string:hint` | At least 8 characters. |
| 361 | `jsx-text` | Zone |
| 398 | `jsx-attr:title` | Delete account |
| 399 | `template-literal:description` | Permanently delete …? This can't be undone. |
| 403 | `jsx-text` | Cancel |
| 406 | `jsx-text` | Delete |
| 462 | `template-literal:title` | Edit … |
| 466 | `jsx-text` | Cancel |
| 469 | `jsx-text` | Save changes |
| 482 | `jsx-text` | Full name |
| 488 | `jsx-text` | Email |
| 500 | `conditional-string` | Assigned zone |
| 500 | `conditional-string` | Home zone |
| 513 | `jsx-text` | Reassigning takes effect immediately — this officer loses access to their old zone's complaints, and any still assigned to them there become unassigned. |
| 522 | `jsx-attr:label` | Account is active |

### `pages/admin/ZonesPage.tsx` (52)

| Line | Kind | Text |
|---|---|---|
| 41 | `jsx-text` | Zones &amp; SLAs |
| 44 | `jsx-text` | Manage zones, category SLA targets, and system-wide settings. |
| 50 | `jsx-text` | Zones |
| 51 | `jsx-text` | SLAs |
| 52 | `jsx-text` | Settings |
| 89 | `conditional-string` | Something went wrong. Please try again. |
| 99 | `jsx-text` | Create zone |
| 109 | `jsx-text` | Code |
| 110 | `jsx-text` | Name |
| 111 | `jsx-text` | Status |
| 112 | `jsx-text` | Actions |
| 143 | `jsx-text` | Assign officer |
| 146 | `jsx-text` | Edit |
| 158 | `jsx-text` | Delete |
| 180 | `jsx-attr:title` | Delete zone |
| 181 | `template-literal:description` | Permanently delete …? This only works if nothing references it. |
| 185 | `jsx-text` | Cancel |
| 188 | `jsx-text` | Delete |
| 239 | `conditional-string` | Something went wrong. Please try again. |
| 248 | `jsx-attr:title` | Create zone |
| 249 | `jsx-attr:description` | Click the map to set the zone's centre point — routing uses nearest-centroid, so every location maps to exactly one zone. |
| 254 | `jsx-text` | Cancel |
| 257 | `jsx-text` | Create zone |
| 271 | `jsx-text` | Code |
| 276 | `jsx-attr-maybe:hint` | Permanent once created. |
| 283 | `jsx-text` | Name |
| 287 | `jsx-attr:placeholder` | Ward 12 – North |
| 294 | `jsx-text` | Centre point |
| 324 | `conditional-string` | Something went wrong. Please try again. |
| 333 | `template-literal:title` | Edit … |
| 334 | `jsx-attr:description` | The zone code can't be changed here. |
| 338 | `jsx-text` | Cancel |
| 341 | `jsx-text` | Save changes |
| 354 | `jsx-text` | Name |
| 360 | `jsx-attr:label` | Zone is active (accepts new complaints) |
| 390 | `conditional-string` | Something went wrong. Please try again. |
| 399 | `template-literal:title` | Assign officer to … |
| 400 | `jsx-attr:description` | Takes effect immediately — the officer's non-terminal complaints in their old zone become unassigned. |
| 404 | `jsx-text` | Cancel |
| 407 | `jsx-text` | Assign |
| 420 | `jsx-text` | Officer |
| 450 | `jsx-text` | Applies to complaints accepted after the change — work already in progress keeps its original target. |
| 456 | `jsx-text` | Category |
| 457 | `jsx-text` | Target (hours) |
| 458 | `jsx-text` | Actions |
| 495 | `template-literal` | … SLA updated |
| 497 | `conditional-string` | Couldn't update. |
| 516 | `jsx-text` | Save |
| 546 | `conditional-string` | Couldn't update. |
| 559 | `jsx-text` | How long a Resolved complaint waits for citizen confirmation before auto-closing. An auto-close credits no points. |
| 564 | `jsx-text` | Hours |
| 576 | `jsx-text` | Save |

### `pages/citizen/ComplaintDetailPage.tsx` (24)

| Line | Kind | Text |
|---|---|---|
| 55 | `jsx-attr:title` | Complaint not found |
| 56 | `jsx-attr:description` | It may have been removed, or you don't have access to it. |
| 62 | `jsx-text` | Back to My Complaints |
| 129 | `conditional-string` | Something went wrong. Please try again. |
| 141 | `jsx-text` | My Complaints |
| 158 | `jsx-text` | · filed |
| 174 | `jsx-text` | Assigned to Officer # |
| 177 | `jsx-text` | cases resolved so far |
| 183 | `jsx-text` | Description |
| 194 | `jsx-text` | Evidence |
| 203 | `jsx-text` | A clearer photo is needed |
| 206 | `jsx-text` | The officer reviewing this complaint asked for better evidence before proceeding. |
| 222 | `jsx-text` | Resubmit evidence |
| 230 | `jsx-text` | Is this actually fixed? |
| 233 | `jsx-text` | The officer marked this as resolved. Confirm it, or dispute it if the issue is still there. |
| 243 | `jsx-text` | Confirm the fix |
| 247 | `jsx-text` | It's not actually fixed |
| 265 | `jsx-attr:title` | Dispute this resolution |
| 266 | `jsx-attr:description` | Explain why the issue isn't actually fixed, and attach a fresh photo as proof. |
| 270 | `jsx-text` | Cancel |
| 277 | `jsx-text` | Submit dispute |
| 293 | `jsx-text` | Reason |
| 299 | `jsx-attr:placeholder` | What's still wrong? |
| 303 | `jsx-text` | Fresh photo |

### `pages/citizen/DashboardPage.tsx` (20)

| Line | Kind | Text |
|---|---|---|
| 61 | `jsx-text` | Here's what's happening with your reports. |
| 66 | `jsx-text` | File a complaint |
| 83 | `jsx-attr:label` | Active complaints |
| 84 | `jsx-attr:label` | Resolved |
| 87 | `jsx-attr:label` | Needs your attention |
| 93 | `jsx-attr:label` | Civic Service Points |
| 114 | `conditional-string` | 1 complaint needs |
| 115 | `template-literal` | … complaints need |
| 116 | `jsx-text` | your attention |
| 135 | `jsx-text` | Recent complaints |
| 138 | `jsx-text` | View all |
| 151 | `jsx-attr:title` | No complaints yet |
| 152 | `jsx-attr:description` | Report your first civic issue — a photo, a pin on the map, and a category is all it takes. |
| 153 | `jsx-text` | File a complaint |
| 181 | `jsx-text` | Civic Service Points |
| 193 | `jsx-text` | this month |
| 202 | `jsx-text` | View badges &amp; leaderboard |
| 210 | `jsx-text` | Explore the feed |
| 214 | `jsx-text` | See what's being reported and fixed in your zone. |
| 222 | `jsx-text` | Open feed |

### `pages/citizen/FeedPage.tsx` (9)

| Line | Kind | Text |
|---|---|---|
| 48 | `jsx-text` | Feed |
| 51 | `conditional-string` | What's being reported in your zone |
| 51 | `template-literal` | What's being reported in … |
| 57 | `jsx-text` | Category |
| 73 | `jsx-attr:label` | Include closed & rejected |
| 92 | `conditional-string:title` | No complaints match these filters |
| 92 | `conditional-string:title` | Nothing reported yet |
| 95 | `conditional-string:description` | Try a different category or include closed complaints. |
| 96 | `conditional-string:description` | Once neighbors start reporting issues in your zone, they'll show up here. |

### `pages/citizen/FileComplaintPage.tsx` (45)

| Line | Kind | Text |
|---|---|---|
| 183 | `conditional-string` | Something went wrong. Please try again. |
| 223 | `jsx-text` | File a complaint |
| 225 | `jsx-text` | Let us know what problems you're facing. |
| 243 | `jsx-text` | What happened? |
| 249 | `jsx-attr:placeholder` | e.g. There is a deep pothole in the middle of the road near the market… |
| 252 | `jsx-attr-maybe:hint` | A few sentences is enough — this also helps us guess the category on the next step. |
| 261 | `jsx-text` | Continue |
| 271 | `jsx-text` | Category |
| 275 | `jsx-text` | Matched from your description — change it below if it's wrong. |
| 280 | `jsx-text` | We couldn't guess a category from your description — pick the closest match. |
| 307 | `jsx-text` | Back |
| 314 | `jsx-text` | Continue |
| 324 | `jsx-text` | Photo evidence |
| 326 | `jsx-text` | Up to |
| 326 | `jsx-text` | photos. We'll try to read the location from the first one automatically. |
| 333 | `jsx-text` | Location |
| 337 | `jsx-text` | Checking the photo for a location… |
| 343 | `jsx-text` | Location detected from your photo. |
| 349 | `conditional-string` | Hide map |
| 349 | `conditional-string` | Change manually |
| 356 | `jsx-text` | Your photo didn't have a location saved in it — drop a pin below. |
| 361 | `jsx-text` | Add a photo above, or drop a pin below. |
| 371 | `jsx-text` | Zone |
| 382 | `conditional-string:hint` | Auto-filled from the location above — change it if it's wrong. |
| 400 | `jsx-text` | Back |
| 407 | `jsx-text` | Continue |
| 416 | `jsx-text` | Review |
| 419 | `jsx-attr:label` | Description |
| 422 | `jsx-attr:label` | Category |
| 434 | `jsx-attr:label` | Zone |
| 437 | `template-literal:label` | Photos (…) |
| 449 | `jsx-text` | Back |
| 457 | `jsx-text` | Submit complaint |
| 482 | `jsx-attr:alt` | Evidence preview |
| 543 | `jsx-text` | Complaint filed |
| 546 | `jsx-text` | Reference |
| 546 | `jsx-text` | — we'll keep you posted as it moves through review. |
| 551 | `jsx-text` | AI photo screening |
| 561 | `template-literal:alt` | Evidence photo … |
| 571 | `jsx-text` | Analyzing photo |
| 579 | `template-literal` | (…% confidence) |
| 585 | `jsx-text` | AI screening was unavailable — an officer will review it directly. |
| 596 | `jsx-text` | File another |
| 599 | `jsx-text` | Back to dashboard |
| 602 | `jsx-text` | View my complaint |

### `pages/citizen/GamificationPage.tsx` (18)

| Line | Kind | Text |
|---|---|---|
| 52 | `jsx-text` | My Kartavya |
| 60 | `jsx-text` | Civic Service Points |
| 68 | `jsx-text` | Lifetime |
| 74 | `jsx-text` | This month |
| 82 | `jsx-text` | Badges |
| 92 | `jsx-text` | No badges earned yet — file and see complaints through to resolution to start earning them. |
| 126 | `jsx-text` | Points ledger |
| 136 | `jsx-attr:title` | No point activity yet |
| 137 | `jsx-attr:description` | Points show up here as your complaints move through their lifecycle. |
| 182 | `jsx-text` | Leaderboard |
| 192 | `jsx-text` | My zone |
| 204 | `jsx-text` | Monthly |
| 219 | `jsx-attr:title` | No leaderboard activity yet |
| 220 | `jsx-attr:description` | Rankings appear once citizens start earning points in this scope. |
| 243 | `template-literal` | Citizen #… |
| 245 | `jsx-text` | (you) |
| 261 | `template-literal` | Citizen #… |
| 262 | `jsx-text` | (you) |

### `pages/citizen/MyComplaintsPage.tsx` (17)

| Line | Kind | Text |
|---|---|---|
| 100 | `jsx-text` | My Complaints |
| 104 | `jsx-text` | File a complaint |
| 119 | `conditional-string` | 1 complaint needs your action |
| 120 | `template-literal` | … complaints need your action |
| 121 | `jsx-text` | View |
| 128 | `jsx-text` | Status |
| 143 | `jsx-text` | Category |
| 158 | `jsx-text` | Zone |
| 173 | `jsx-text` | Sort by |
| 197 | `jsx-text` | Needs my action |
| 202 | `jsx-text` | Clear filters |
| 217 | `conditional-string:title` | No complaints match these filters |
| 217 | `conditional-string:title` | No complaints yet |
| 220 | `conditional-string:description` | Try a different status, category, or zone. |
| 221 | `conditional-string:description` | Report your first civic issue — a photo, a pin on the map, and a category is all it takes. |
| 224 | `jsx-text` | File a complaint |
| 232 | `jsx-text` | Showing |

### `pages/officer/ClusterDetailPage.tsx` (19)

| Line | Kind | Text |
|---|---|---|
| 61 | `jsx-attr:title` | Cluster not found |
| 62 | `jsx-attr:description` | It may not exist, or it isn't in your assigned zone. |
| 65 | `jsx-text` | Back to Clusters |
| 85 | `template-literal` | Added to … of … member complaints (only those In Progress or Under Resolution). |
| 94 | `conditional-string` | Something went wrong. Please try again. |
| 106 | `jsx-text` | Clusters |
| 123 | `jsx-text` | · formed |
| 131 | `jsx-attr:label` | Reports |
| 132 | `jsx-attr:label` | Unique reporters |
| 133 | `jsx-attr:label` | Severity score |
| 150 | `jsx-text` | Batch update status… |
| 153 | `jsx-text` | Add note to all |
| 159 | `jsx-text` | Member complaints |
| 178 | `jsx-attr:title` | Add note to all members |
| 179 | `jsx-attr:description` | Posted to every complaint in this cluster that's currently In Progress or Under Resolution — others are skipped. |
| 183 | `jsx-text` | Cancel |
| 186 | `jsx-text` | Post note |
| 199 | `jsx-text` | Note |
| 205 | `jsx-attr:placeholder` | What's the latest update? |

### `pages/officer/ClustersPage.tsx` (6)

| Line | Kind | Text |
|---|---|---|
| 37 | `jsx-text` | Clusters |
| 39 | `jsx-text` | Nearby same-category reports grouped as one physical issue in your zone. |
| 51 | `jsx-attr:title` | No clusters yet |
| 52 | `jsx-attr:description` | When several nearby citizens report the same issue, they'll be grouped here. |
| 85 | `jsx-text` | report |
| 88 | `jsx-text` | unique reporter |

### `pages/officer/ComplaintDetailPage.tsx` (45)

| Line | Kind | Text |
|---|---|---|
| 112 | `jsx-attr:title` | Complaint not found |
| 113 | `jsx-attr:description` | It may not exist, or it isn't in your assigned zone. |
| 116 | `jsx-text` | Back to Queue |
| 150 | `conditional-string` | Something went wrong. Please try again. |
| 198 | `conditional-string` | Something went wrong. Please try again. |
| 256 | `template-literal` | Officer #… |
| 268 | `jsx-text` | Queue |
| 285 | `jsx-text` | · filed |
| 300 | `jsx-text` | Assigned: |
| 309 | `jsx-text` | Part of a cluster of |
| 309 | `jsx-text` | report |
| 310 | `jsx-text` | unique reporter |
| 311 | `jsx-text` | ) — resolving this may resolve others automatically. |
| 327 | `jsx-text` | Cluster cascade |
| 334 | `jsx-text` | Dismiss |
| 346 | `conditional-string` | moved to Resolved |
| 346 | `template-literal` | left at … |
| 357 | `jsx-text` | Pick up this complaint |
| 360 | `jsx-text` | Claim it to start reviewing the submitted evidence. |
| 363 | `jsx-text` | Claim |
| 371 | `jsx-text` | Evidence |
| 380 | `jsx-text` | Review the latest photo |
| 383 | `jsx-text` | The AI note above is advisory only — your verdict decides what happens next. |
| 397 | `jsx-text` | Valid |
| 404 | `jsx-text` | Needs more evidence |
| 412 | `jsx-text` | Reject |
| 419 | `jsx-text` | Reason |
| 425 | `jsx-attr:placeholder` | Why? |
| 436 | `jsx-text` | Submit verdict |
| 444 | `jsx-text` | This complaint was disputed by the citizen and is awaiting an admin's ruling. No officer action is available until then. |
| 454 | `jsx-text` | Move this complaint |
| 460 | `jsx-text` | Start work |
| 463 | `jsx-text` | Recall for more evidence |
| 469 | `jsx-text` | Move to Under Resolution |
| 474 | `jsx-text` | Mark resolved |
| 478 | `jsx-text` | Mark unresolvable |
| 487 | `jsx-text` | Post a progress note |
| 490 | `jsx-text` | Visible to the citizen, with your officer ID. |
| 496 | `jsx-attr:placeholder` | What's the latest update? |
| 501 | `jsx-text` | Post note |
| 525 | `jsx-text` | Cancel |
| 546 | `jsx-text` | Reason |
| 552 | `jsx-attr:placeholder` | Explain why. |
| 558 | `jsx-text` | Closing note (optional) |
| 563 | `jsx-attr:placeholder` | Visible to the citizen. |

### `pages/officer/DashboardPage.tsx` (18)

| Line | Kind | Text |
|---|---|---|
| 50 | `jsx-text` | Dashboard |
| 53 | `jsx-text` | Live status for your assigned zone — most urgent complaints first. |
| 72 | `jsx-attr:label` | Active complaints |
| 77 | `jsx-attr:label` | Overdue |
| 85 | `jsx-attr:label` | Active clusters |
| 90 | `jsx-attr:label` | Avg. resolution (mo.) |
| 103 | `jsx-text` | Needs attention |
| 105 | `jsx-text` | Open queue |
| 119 | `jsx-attr:title` | Nothing urgent |
| 120 | `jsx-attr:description` | Your zone's queue is caught up — nice work. |
| 143 | `jsx-text` | Clusters |
| 149 | `jsx-text` | active of |
| 149 | `jsx-text` | total |
| 157 | `jsx-text` | View clusters |
| 162 | `jsx-text` | Zone totals |
| 165 | `jsx-text` | Total complaints |
| 171 | `jsx-text` | Resolved |
| 181 | `jsx-text` | By category |

### `pages/officer/QueuePage.tsx` (22)

| Line | Kind | Text |
|---|---|---|
| 151 | `jsx-text` | Complaint Queue |
| 173 | `jsx-text` | Search |
| 177 | `jsx-attr:placeholder` | Complaint ID or category… |
| 186 | `jsx-text` | Category |
| 201 | `jsx-text` | Severity |
| 222 | `jsx-text` | selected |
| 226 | `jsx-text` | Clear |
| 229 | `jsx-text` | Batch update status… |
| 244 | `jsx-attr:title` | No complaints match |
| 245 | `jsx-attr:description` | Try a different tab or filter. |
| 255 | `jsx-attr:aria-label` | Select all on this page |
| 260 | `jsx-text` | Category |
| 261 | `jsx-text` | Status |
| 262 | `jsx-text` | Severity |
| 264 | `jsx-text` | Assigned |
| 265 | `jsx-text` | Filed |
| 266 | `jsx-text` | Actions |
| 272 | `jsx-text` | No complaints on this page. |
| 279 | `template-literal:aria-label` | Select … |
| 310 | `template-literal` | Officer #… |
| 323 | `jsx-text` | Claim |
| 330 | `jsx-text` | View |

### `pages/public/ForbiddenPage.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 14 | `jsx-attr:title` | You don't have access to this page |
| 15 | `jsx-attr:description` | Kartavya keeps citizen, officer, and admin views strictly separate. If you think this is a mistake, contact your administrator. |
| 18 | `jsx-text` | Back to your dashboard |

### `pages/public/LandingPage.tsx` (14)

| Line | Kind | Text |
|---|---|---|
| 101 | `jsx-text` | Kartavya |
| 109 | `jsx-text` | Sign in |
| 112 | `jsx-text` | Get started |
| 122 | `jsx-text` | What gets seen, gets fixed. |
| 125 | `jsx-text` | Kartavya turns a photo of a civic problem into a transparent, accountable record — from the first report to the final fix. |
| 130 | `jsx-text` | Report an issue |
| 133 | `jsx-text` | Sign in |
| 173 | `jsx-text` | Every complaint's journey |
| 194 | `jsx-text` | Not fixed properly? Citizens can reopen it. Evidence doesn't hold up? Officers can reject it. Every branch is recorded. |
| 219 | `jsx-text` | Something in your ward needs fixing? |
| 223 | `jsx-text` | Report an issue |
| 231 | `jsx-text` | Kartavya — a civic accountability platform. |
| 234 | `jsx-text` | Sign in |
| 237 | `jsx-text` | Register |

### `pages/public/LoginPage.tsx` (9)

| Line | Kind | Text |
|---|---|---|
| 50 | `jsx-text` | Kartavya |
| 54 | `jsx-text` | Sign in |
| 56 | `jsx-text` | Track your complaints, or pick up where you left off. |
| 70 | `jsx-text` | Email |
| 83 | `jsx-text` | Password |
| 94 | `jsx-text` | Sign in |
| 100 | `jsx-text` | Demo mode — see the browser console for sample logins. |
| 106 | `jsx-text` | New to Kartavya? |
| 108 | `jsx-text` | Create a citizen account |

### `pages/public/NotFoundPage.tsx` (3)

| Line | Kind | Text |
|---|---|---|
| 10 | `jsx-attr:title` | Page not found |
| 11 | `jsx-attr:description` | The page you're looking for doesn't exist or has moved. |
| 12 | `jsx-text` | Back to home |

### `pages/public/RegisterPage.tsx` (12)

| Line | Kind | Text |
|---|---|---|
| 70 | `jsx-text` | Kartavya |
| 75 | `jsx-text` | Create a citizen account |
| 78 | `jsx-text` | Officers and admins are added by an administrator. |
| 92 | `jsx-text` | Full name |
| 104 | `jsx-text` | Email |
| 117 | `jsx-text` | Password |
| 123 | `conditional-string:hint` | At least 8 characters. |
| 130 | `jsx-text` | Confirm password |
| 142 | `jsx-text` | Your zone |
| 168 | `jsx-text` | Create account |
| 174 | `jsx-text` | Already have an account? |
| 176 | `jsx-text` | Sign in |

### `services/http.ts` (1)

| Line | Kind | Text |
|---|---|---|
| 73 | `template-literal` | Bearer … |

