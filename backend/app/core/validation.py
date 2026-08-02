"""Pydantic request models -> 400 VALIDATION_ERROR with per-field details.

Routes declare what they accept and get a parsed object; they never touch
`request.json` directly and never hand-roll a field check.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar, cast

from flask import request
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.domain.errors import ErrorDetail, ValidationError

F = TypeVar("F", bound=Callable[..., Any])
M = TypeVar("M", bound=BaseModel)


def _to_details(exc: PydanticValidationError) -> list[ErrorDetail]:
    """Flatten pydantic's error list into the contract's details array."""
    details: list[ErrorDetail] = []
    for err in exc.errors():
        location = ".".join(str(part) for part in err["loc"]) or "body"
        details.append(ErrorDetail(field=location, issue=err["msg"]))
    return details


def parse_model(model: type[M], data: Any) -> M:
    """Validate arbitrary data against a model, raising the domain error."""
    try:
        return model.model_validate(data)
    except PydanticValidationError as exc:
        raise ValidationError(
            "The request could not be processed.", details=_to_details(exc)
        ) from exc


def validate_body(model: type[M]) -> Callable[[F], F]:
    """Parse and validate the JSON body, passing it in as `body=`.

        @bp.post("/complaints/<complaint_id>/dispute")
        @require_role(UserRole.CITIZEN)
        @validate_body(DisputeRequest)
        def dispute(complaint_id: str, body: DisputeRequest): ...
    """

    def decorator(view: F) -> F:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            payload = request.get_json(silent=True)
            if payload is None:
                raise ValidationError("A JSON request body is required.")
            kwargs["body"] = parse_model(model, payload)
            return view(*args, **kwargs)

        return cast(F, wrapper)

    return decorator


def validate_query(model: type[M]) -> Callable[[F], F]:
    """Same, for query strings — passed in as `query=`.

    Uses `getlist` so repeatable filters (the contract's `status` parameter is
    repeatable) survive; single values are unwrapped so a model can declare
    plain `int` / `str` fields.
    """

    def decorator(view: F) -> F:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            raw: dict[str, Any] = {}
            for key in request.args:
                values = request.args.getlist(key)
                raw[key] = values if len(values) > 1 else values[0]
            kwargs["query"] = parse_model(model, raw)
            return view(*args, **kwargs)

        return cast(F, wrapper)

    return decorator
