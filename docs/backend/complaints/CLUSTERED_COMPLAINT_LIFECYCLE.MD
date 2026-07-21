Complaint clustering is a rule-based mechanism for treating nearby reports of the same physical problem as one issue.

## 1. How a complaint cluster is formed

When a citizen submits a complaint, the server:

1. Validates the selected category, photo, location, and active zone.
2. Creates the complaint with status `SUBMITTED`.
3. Starts AI photo screening in the background. AI does not decide clustering.
4. Searches for nearby complaints of the same category using geographic distance, approximately 50–100 metres.
5. Links matching complaints into a cluster and recalculates severity.

The matching is based on:

- Same complaint category, such as Pothole or Garbage.
- Nearby geographical position.
- Existing complaint still being relevant/open according to the clustering rules.
- The cluster belongs to a specific zone.

There is no machine-learning clustering described. It is based on distance and category.

### Standalone complaint

If no nearby matching complaint exists, the complaint remains standalone:

```text
clusterId: null
```

Its severity is based only on its own upvotes.

### Second matching complaint

When another nearby complaint of the same category arrives:

```text
Complaint A + Complaint B → Cluster 1
```

Both complaints become members of the cluster. Later matching complaints join the same cluster.

Membership is effectively permanent. A complaint is not removed from its cluster when it is disputed or reopened.

## 2. Cluster severity

A cluster’s severity score is:

```text
(unique reporters − 1) × 3 + total upvotes
```

For example:

| Situation | Score |
|---|---:|
| One standalone complaint, 0 upvotes | 0 |
| Two different citizens report it, 0 upvotes | 3 |
| Three different citizens report it, 2 upvotes | 8 |
| Three reports from only one citizen, 2 upvotes | 2 |

The important point is that distinct citizens count, not the raw number of complaints. One citizen cannot repeatedly file duplicates to artificially increase urgency.

The API returns a label derived from the score:

```text
LOW, MEDIUM, HIGH, or CRITICAL
```

The thresholds are: `LOW` 0–4, `MEDIUM` 5–14, `HIGH` 15–29, `CRITICAL` 30+.

The cluster also exposes:

- `reportCount`: all complaints in the cluster, including duplicates from one person.
- `uniqueReporterCount`: distinct citizens.
- `severityScore`
- `severityLabel`
- `centroidLat` and `centroidLng`: average location of the members.
- `statusSummary`: counts of members in each current status.

## 3. A cluster has no single status

A cluster does not store one overall status.

Instead, its state is calculated from the statuses of its members. For example:

```json
{
  "RESOLVED": 3,
  "CLOSED": 2,
  "REOPENED": 1
}
```

This means members can be at different stages simultaneously.

This is intentional because:

- Some complaints may still need evidence.
- Some citizens may have confirmed the fix.
- One citizen may dispute the resolution.
- Some complaints may already be rejected or marked unresolvable.

## 4. How officers handle clustered complaints

### Viewing clusters

- Officers can see clusters only in their assigned zone.
- Admins can see clusters across all zones.
- A cluster detail view lists all current member complaints.
- Reporter identity is hidden from officers.

### Handling one complaint normally

An officer can process a member through the normal lifecycle:

```text
SUBMITTED
→ EVIDENCE_UNDER_REVIEW
→ UNDER_REVIEW
→ IN_PROGRESS
→ UNDER_RESOLUTION
→ RESOLVED
```

`RESOLVED` does not mean finally closed. The citizen must confirm the fix, or the system eventually auto-closes it.

### Resolving one member causes a cascade

When an officer moves one clustered complaint to `RESOLVED`, the server automatically tries to move other eligible members to `RESOLVED`.

Members that can be cascaded:

- `UNDER_REVIEW`
- `IN_PROGRESS`
- `UNDER_RESOLUTION`

They receive their own `status_history` entry with actor `SYSTEM`.

Example:

```text
Member A: UNDER_RESOLUTION → RESOLVED by officer
Member B: IN_PROGRESS → RESOLVED by SYSTEM
Member C: UNDER_REVIEW → RESOLVED by SYSTEM
```

### Members that are not cascaded

The following members are skipped:

- Already `RESOLVED`
- `CLOSED`
- `REJECTED`
- `UNRESOLVABLE`
- `SUBMITTED`
- `EVIDENCE_UNDER_REVIEW`
- `NEEDS_MORE_EVIDENCE`
- `REOPENED`

The evidence-stage members are never automatically resolved. Their evidence must still be reviewed independently. This prevents a complaint with poor or fake evidence from bypassing the evidence process merely because another complaint in the cluster was resolved.

`REOPENED` members are skipped for the same reason. A citizen who disputed a resolution is waiting on an admin's dispute-review verdict, and that verdict must never be preempted — a sibling being fixed elsewhere in the cluster cannot sweep a pending dispute to `RESOLVED` on its own. See [section 9](#9-disputing-a-clustered-complaint) for exactly how this plays out.

The response reports each member as either:

```text
CASCADED
SKIPPED
```

## 5. Batch handling of a cluster

Officers can use:

```text
POST /officer/complaints/batch-status
```

They can target complaints in two ways:

- Provide specific `complaintIds`.
- Provide a `clusterId` to target all members currently in that cluster.

This is useful when an officer wants to move several complaints together to an earlier stage, for example:

```text
UNDER_REVIEW → IN_PROGRESS
IN_PROGRESS → UNDER_RESOLUTION
```

Unlike the individual status endpoint, **batch updates never automatically cascade** — not even a `status: RESOLVED` batch call. The batch endpoint always processes every complaint separately, validating each one against its own current status, and returns success or failure for each item; it never propagates a move to any complaint beyond the ones it was actually asked to update.

This is actually useful: because batch never cascades, an officer can resolve a *specific subset* of a cluster's members (via `complaintIds`, restricted to whichever are individually sitting at `UNDER_RESOLUTION`) without dragging the rest of the cluster along — something the single-item endpoint can't do, since resolving any one member there always cascades every other eligible member.

Possible per-item failures include:

- Invalid transition.
- Complaint outside the officer’s zone.
- Unknown complaint.
- Missing required reason.

A batch can therefore produce mixed results.

## 6. Adding progress notes to a cluster

An officer can call:

```text
POST /officer/clusters/{clusterId}/notes
```

This adds the same note to every eligible member.

Only members in these stages receive the note:

- `IN_PROGRESS`
- `UNDER_RESOLUTION`

Members in other stages are skipped. If no member is eligible, the request fails with `409`.

Each successful note is stored separately on the individual complaint.

## 7. Evidence handling inside a cluster

Each complaint still needs its own evidence review.

Possible outcomes:

### Valid evidence

```text
EVIDENCE_UNDER_REVIEW → UNDER_REVIEW
```

The SLA timer starts.

### More evidence required

```text
EVIDENCE_UNDER_REVIEW → NEEDS_MORE_EVIDENCE
```

The citizen uploads another photo:

```text
NEEDS_MORE_EVIDENCE → EVIDENCE_UNDER_REVIEW
```

The complaint is reviewed again.

A cluster resolution cannot bypass this evidence gate.

### Rejected evidence

On the first evidence round only:

```text
EVIDENCE_UNDER_REVIEW → REJECTED
```

The complaint becomes terminal and the citizen loses 20 CSP.

If the complaint had already been accepted and is later recalled for better evidence, it cannot subsequently be rejected as fake. It can only be accepted again or sent back for more evidence.

## 8. Citizen confirmation and closing

When an officer resolves a cluster member, that member becomes:

```text
RESOLVED
```

The individual citizen who filed that complaint must confirm the fix:

```text
RESOLVED → CLOSED
```

Confirmation affects only that complaint. Other cluster members remain in their existing states until:

- Their own citizens confirm.
- They are resolved through the cascade.
- They auto-close after the configured timeout.

### Auto-close

If the citizen does not respond within the configured timeout:

```text
RESOLVED → CLOSED
```

This is performed by the system and gives no points.

## 9. Disputing a clustered complaint

Only the original reporter can dispute a resolved complaint.

```text
RESOLVED → REOPENED
```

The citizen must provide **both** a reason and a fresh photo proving the issue persists — the burden of evidence is on the citizen, the same as when the complaint was first filed. The photo is appended to the complaint's evidence history; it does not go through an officer's evidence-review verdict.

The dispute affects only that complaint:

- Other members keep their statuses.
- Already closed members remain closed.
- The disputed complaint remains in the same cluster.
- Its `clusterId` is not cleared.

### An officer can no longer pick a disputed complaint back up directly

`REOPENED` has exactly one legal exit, and it belongs to an admin, not the officer:

```text
POST /admin/complaints/{complaintId}/dispute-review
```

The admin weighs the citizen's reason and photo against the officer's own record and renders one of two verdicts:

- **Upheld** — the fix didn't hold.

  ```text
  REOPENED → IN_PROGRESS
  ```

  The complaint goes back to the same officer's queue and follows the normal lifecycle again (`IN_PROGRESS → UNDER_RESOLUTION → RESOLVED`), and the citizen must confirm again once it's re-resolved.

- **Rejected** — the original resolution stands.

  ```text
  REOPENED → CLOSED
  ```

  The case is over. **No points are credited** for this closure — same as an auto-close timeout — so a citizen can't use a losing dispute to get a second shot at the reward they gave up by disputing instead of confirming.

Resolving another member of the cluster while this dispute is pending does **not** touch it — `REOPENED` is deliberately excluded from the cascade (see [section 4](#members-that-are-not-cascaded)), the same way evidence-phase members are, so a sibling's fix can never sweep a pending dispute to `RESOLVED` behind the admin's back. The complaint sits in `REOPENED` until an explicit verdict lands, cluster or no cluster. (Once the admin *does* uphold the dispute, the complaint is back at `IN_PROGRESS` like any other member — from that point on, a sibling's later cascade can pick it up normally, same as before it was ever disputed.)

## 10. Rewards for clustered complaints

The full complaint-closed reward is paid only once per cluster.

### First confirmed member

The first successful citizen confirmation in a cluster receives:

```text
COMPLAINT_CLOSED: +50 CSP
```

The first person to confirm gets the reward, not necessarily the person who reported first.

### Later confirmed members

Later members receive:

```text
CLUSTER_MEMBER_CLOSED: +10 CSP
```

Their complaints still close normally.

### Same citizen filed multiple cluster members

A citizen can file several complaints that end up in the same cluster. They can receive a cluster reward only once:

- First confirmed complaint: receives the applicable reward.
- Later duplicate complaints: close successfully but give no additional cluster reward.

This prevents reward farming through duplicate submissions.

### SLA bonus remains independent

The on-time bonus is calculated separately for every complaint using that complaint’s own SLA snapshot.

Therefore, a member that receives only the +10 cluster-member reward may still independently receive:

```text
ON_TIME_BONUS: +15 CSP
```

## Overall example

```text
1. Citizen A reports a pothole.
   → Standalone complaint.

2. Citizen B reports the same category within about 100 metres.
   → A and B are linked into Cluster 1.

3. Citizen C reports nearby.
   → C joins Cluster 1.
   → Severity increases based on distinct reporters.

4. Officer resolves A.
   → B and C are also moved to RESOLVED if they passed evidence review.
   → Any evidence-pending member is skipped.

5. Citizen B confirms first.
   → B gets +50 CSP.

6. Citizen A confirms later.
   → A gets +10 CSP.

7. Citizen C disputes, with a reason and a fresh photo.
   → Only C becomes REOPENED.
   → A and B remain closed.
   → C stays in Cluster 1.
   → (If some other complaint in Cluster 1 were resolved right now, it would NOT touch C — REOPENED is skipped by the cascade, so C just keeps waiting for the admin.)

8. An admin reviews the dispute and upholds it.
   → C moves to IN_PROGRESS. Neither the officer nor the citizen could have made this call — only the admin's verdict could move C out of REOPENED.

9. Officer fixes C again.
   → C returns to RESOLVED and must be confirmed again.
   → No new +50 cluster reward is created.

   (Had the admin instead rejected the dispute, C would have gone straight to CLOSED with no points — the case would be over.)
```

In short: clusters combine nearby same-category reports, increase urgency based on distinct reporters, let officers work related complaints together, but preserve individual evidence, status, confirmation, SLA, and reward rules for every complaint.