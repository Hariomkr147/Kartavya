"""Points, badges and leaderboards.

The ledger is append-only and there is no stored total anywhere: lifetime CSP is
`SUM(points_ledger.points_change)`.
"""
