"""JWT issue/verify, `current_user`, and the two route decorators.

The single most important rule in this file:

    Treat JWT claims as a routing hint, NEVER as authorization.

The user row is re-loaded from the database on every request and `is_active` and
`zone_id` are re-checked there. The contract says deactivating a user and
reassigning an officer's zone both take effect immediately — a token minted five
minutes ago still carries the old zone, so authorizing from the token would let
a reassigned officer keep reading their old zone until it expires. That is a
silent privacy breach, not a caching quirk.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Any, TypeVar, cast

import jwt
from flask import current_app, request

from app.domain.enums import UserRole
from app.domain.errors import AuthError, ForbiddenError
from app.extensions import db
from app.models import User

F = TypeVar("F", bound=Callable[..., Any])


# --- Token minting / parsing --------------------------------------------------


def issue_token(user: User) -> tuple[str, datetime]:
    """Mint an HS256 token. Returns (token, expires_at) — the contract's
    `AuthResponse.expiresAt` mirrors the `exp` claim so a client can pre-empt
    expiry without decoding the token.

    There is no refresh endpoint by design. The frontend already redirects to
    login on any 401.
    """
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=current_app.config["JWT_TTL_HOURS"])
    payload = {
        "sub": str(user.id),
        "role": str(user.role),
        "zone_id": user.zone_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(
        payload,
        current_app.config["JWT_SECRET"],
        algorithm=current_app.config["JWT_ALGORITHM"],
    )
    return token, expires_at


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            current_app.config["JWT_SECRET"],
            algorithms=[current_app.config["JWT_ALGORITHM"]],
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Your session has expired. Please log in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Invalid authentication token.") from exc


def _bearer_token() -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Authentication required.")
    return token.strip()


# --- Request-scoped current user ---------------------------------------------

#: Where the resolved caller is stashed for the life of ONE request.
#:
#: ⚠ Deliberately not `flask.g`. `g` is bound to the *application* context, not
#: the request, and one app context can serve several requests — Flask reuses an
#: already-pushed one rather than nesting. Caching the caller on `g` therefore
#: lets request N+1 be authorized as request N's user: two citizens hitting the
#: same app context in turn, and the second one inherits the first one's
#: identity. The request object is the only thing in scope here whose lifetime
#: really is a single request.
_CURRENT_USER_ENV_KEY = "kartavya.current_user"


def load_current_user() -> User:
    """Resolve the caller, re-reading the row from the database.

    Cached for the life of one request only — never across requests.
    """
    cached = request.environ.get(_CURRENT_USER_ENV_KEY)
    if cached is not None:
        return cast(User, cached)

    claims = decode_token(_bearer_token())
    try:
        user_id = int(claims.get("sub", ""))
    except (TypeError, ValueError) as exc:
        raise AuthError("Invalid authentication token.") from exc

    user = db.session.get(User, user_id)
    if user is None or not user.is_active:
        # Same answer for both: a deactivated account and a deleted one must be
        # indistinguishable to the caller.
        raise AuthError("Your account is no longer active.")

    request.environ[_CURRENT_USER_ENV_KEY] = user
    return user


def current_user() -> User:
    """The authenticated caller. Only valid inside a @require_auth route."""
    user = request.environ.get(_CURRENT_USER_ENV_KEY)
    if user is None:
        raise AuthError("Authentication required.")
    return cast(User, user)


# --- Decorators ---------------------------------------------------------------


def require_auth(view: F) -> F:
    """Any authenticated, active user."""

    @wraps(view)
    def wrapper(*args: Any, **kwargs: Any):
        load_current_user()
        return view(*args, **kwargs)

    return cast(F, wrapper)


def require_role(*roles: UserRole) -> Callable[[F], F]:
    """Authenticated AND holding one of these roles.

    401 for "who are you?", 403 for "not you" — the contract distinguishes them,
    and so does the frontend's redirect logic.
    """

    def decorator(view: F) -> F:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            user = load_current_user()
            if user.role not in roles:
                raise ForbiddenError("You do not have access to this resource.")
            return view(*args, **kwargs)

        return cast(F, wrapper)

    return decorator


def require_officer_zone(user: User) -> int:
    """An officer's current zone, or a 403 if somehow unset.

    Officers see exactly one zone — not "usually one". An officer row with a
    null zone_id is a data bug, and failing closed is the only safe reading.
    """
    if user.zone_id is None:
        raise ForbiddenError("Your account is not assigned to a zone.")
    return user.zone_id
