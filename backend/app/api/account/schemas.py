"""Request models for /users/me*.

TODO(phase 2) — the models this package needs:

  * UpdateProfileRequest   — name, displayName. Not email, not role, not zone:
                             a user cannot promote themselves or move zones.
  * ChangePasswordRequest  — currentPassword, newPassword (min 8). The current
                             password is required even though the caller is
                             already authenticated.

Use `model_config = ConfigDict(extra="forbid")` on each.
"""

from __future__ import annotations
