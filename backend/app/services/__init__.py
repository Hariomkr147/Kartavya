"""WRITE SIDE — business operations, grouped by AGGREGATE (the thing they change).

Not grouped by who calls them. `services/complaints/lifecycle.py` is imported by
officer routes, admin routes, citizen routes AND the background jobs, and that
is the point: a status transition is legal or illegal regardless of role, so
there must be exactly one implementation of it.

Two rules for this layer:

  * It is the ONLY layer that opens transactions. One `commit()` per request,
    at the service. Routes never commit.
  * Anything that must be atomic together lives in ONE function — a status
    change, its history row, its points and its badge award are one transaction,
    so a crash halfway leaves nothing behind.

Background jobs open their own session and commit it themselves. Never hand a
request-scoped session to a thread.
"""
