"""Domain error -> the one error envelope, registered as Flask error handlers.

    {"error": {"code": ..., "message": ..., "details": [{"field","issue"}]}}

The frontend already reads `error.code` and `error.details` off every failure
(`frontend/src/services/http.ts`), so this shape is load-bearing.

Routes contain no try/except. Services raise; this module renders.
"""

from __future__ import annotations

import logging

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from app.domain.errors import DomainError, ErrorDetail

logger = logging.getLogger(__name__)


def error_response(
    code: str, message: str, http_status: int, details: list[ErrorDetail] | None = None
):
    payload: dict[str, object] = {"code": code, "message": message}
    if details:
        payload["details"] = [d.to_dict() for d in details]
    return jsonify({"error": payload}), http_status


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(DomainError)
    def _handle_domain_error(exc: DomainError):
        return error_response(exc.code, exc.message, exc.http_status, exc.details)

    @app.errorhandler(HTTPException)
    def _handle_http_exception(exc: HTTPException):
        """Werkzeug's own 404/405/413/... in the same envelope as everything else.

        A client must never have to parse two different error shapes depending
        on whether the failure came from routing or from a service.
        """
        code = {
            400: "VALIDATION_ERROR",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            409: "CONFLICT",
            413: "PAYLOAD_TOO_LARGE",
        }.get(exc.code or 500, "INTERNAL_ERROR")
        return error_response(code, exc.description or "Request failed.", exc.code or 500)

    @app.errorhandler(Exception)
    def _handle_unexpected(exc: Exception):
        """500 — log the detail, never return it.

        An unhandled exception's message can carry a SQL fragment, a file path,
        or a row's contents. None of that belongs in a response body.
        """
        logger.exception("Unhandled exception: %s", exc)
        return error_response(
            "INTERNAL_ERROR", "Something went wrong on our end.", 500
        )
