"""The complaint aggregate: lifecycle, submission, evidence, clusters, upvotes.

`lifecycle.py` is the single choke point for every status write in the system.
Nothing outside it may assign `complaint.status` — not this package's other
modules, not the API layer, not the jobs.
"""
