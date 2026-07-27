"""Read-heavy aggregate reporting: zone, system, officer, CSV export.

All three dashboards share ONE definition of `avgResolutionHours`
(`domain.sla.resolution_hours`). The frontend mock computes it three other ways;
the contract wins.
"""
