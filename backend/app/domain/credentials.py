"""What a stored `password_hash` can mean, beyond "a hash".

A citizen who only ever signs in with Google has no password. `password_hash`
stays NOT NULL (every existing query, seed and admin path assumes a string), so
such an account stores an *unusable* marker instead: the text `!` followed by
random characters. No password hashing scheme produces a string starting with
`!`, and Werkzeug's `check_password_hash` returns False for it, so password
login and change-password behave exactly as they do for a wrong password.

Django uses the same convention for the same reason.
"""

from __future__ import annotations

UNUSABLE_PREFIX = "!"


def unusable_password_marker(random_text: str) -> str:
    """The value to store for an account with no password. Randomness comes from the caller."""
    return UNUSABLE_PREFIX + random_text


def has_usable_password(password_hash: str) -> bool:
    return not password_hash.startswith(UNUSABLE_PREFIX)
