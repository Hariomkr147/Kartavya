# `tests/services/`

In-memory SQLite plus factories. Fast, but not free — keep the bulk of the
project's tests in `tests/domain/` instead.

What genuinely belongs here, because it cannot be tested purely:

- **Cluster linking and the cascade.** Which siblings move, which are skipped,
  and that a REOPENED member is never swept along.
- **The one-time cluster reward under TWO CONCURRENT confirms.** The atomic
  test-and-set on `reward_granted` is the highest-stakes race in the system;
  getting it wrong pays +50 twice. Test it with two sessions, not one.
- **The guarded transition under two concurrent claims** — one wins, the other
  gets a clean 409.
- **Points on confirm vs auto-close vs an admin-rejected dispute.** Only the
  first credits anything.
- **The RESTRICT pre-checks** on user and zone deletion: a 409 with counts, not
  an IntegrityError surfacing as a 500.

## The highest-value hour available to this team

Port `frontend/src/mocks/integration/lifecycle.test.ts` (449 lines) to pytest
**before** implementing the lifecycle. It already encodes the cluster cascade,
the dispute-review flow and reward-once behaviour as executable assertions —
porting it gives you a specification of the hardest cases up front, instead of
discovering them one bug at a time.
