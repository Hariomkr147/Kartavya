"""Cross-cutting HTTP plumbing: auth, scoping, errors, validation, signing.

What used to be called "middlewares" in the older layout. Flask has no
middleware concept — what lives here is decorators, error handlers and helpers
that every audience package leans on.
"""
