"""Work that happens outside the request cycle.

Three rules for all three jobs:

  1. Each opens its OWN session and commits it. Never hand a request-scoped
     session to a thread.
  2. Status changes still go through `services/complaints/lifecycle.py`, so
     SYSTEM transitions get proper history rows like everything else.
  3. Each needs an app context of its own — the scheduler thread has none.
"""
