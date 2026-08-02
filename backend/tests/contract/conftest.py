"""Machinery for validating live responses against `backend/api/openapi.yaml`.

The contract is the authority (CLAUDE.md), so these tests assert against the
spec file itself rather than against a hand-copied expectation. If the contract
changes, they fail here rather than in the browser.

OpenAPI 3.0 is *almost* JSON Schema draft-4 but not quite: `nullable: true` is
the one divergence that matters to us, so `_to_json_schema` rewrites it before
handing anything to `jsonschema`.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

yaml = pytest.importorskip("yaml", reason="PyYAML is required for contract tests")
jsonschema = pytest.importorskip("jsonschema", reason="jsonschema is required for contract tests")

SPEC_PATH = Path(__file__).resolve().parents[2] / "api" / "openapi.yaml"


def _to_json_schema(node: Any) -> Any:
    """Translate OpenAPI 3.0 dialect into something `jsonschema` understands.

    `nullable: true` becomes a union with "null". Everything else in this spec —
    `allOf`, `oneOf`, `$ref`, `required`, `enum` — is already valid JSON Schema.
    """
    if isinstance(node, list):
        return [_to_json_schema(item) for item in node]
    if not isinstance(node, dict):
        return node

    result = {key: _to_json_schema(value) for key, value in node.items()}

    if result.pop("nullable", False):
        # An `enum` beside `nullable: true` does not list null, but null is
        # still permitted — that is how the contract writes
        # `citizenActionNeeded`, and `openapi-typescript` reads it the same way
        # (`... | null` in api.generated.ts). Widen the enum to match.
        if "enum" in result and None not in result["enum"]:
            result["enum"] = [*result["enum"], None]
        if "type" in result:
            result["type"] = [result["type"], "null"]
        elif "allOf" in result:
            # `allOf: [$ref]` + `nullable` is how the contract expresses an
            # optional object reference (ComplaintDetail.reporter, and others).
            result["anyOf"] = [{"allOf": result.pop("allOf")}, {"type": "null"}]
        elif "$ref" in result:
            result["anyOf"] = [{"$ref": result.pop("$ref")}, {"type": "null"}]
    return result


@pytest.fixture(scope="session")
def openapi_spec() -> dict[str, Any]:
    with SPEC_PATH.open() as handle:
        return _to_json_schema(copy.deepcopy(yaml.safe_load(handle)))


@pytest.fixture(scope="session")
def assert_matches_schema(openapi_spec):
    """Assert a payload satisfies a named schema from `components/schemas`."""
    registry_root = {"components": openapi_spec["components"]}

    def _assert(payload: Any, schema_name: str) -> None:
        schemas = openapi_spec["components"]["schemas"]
        assert schema_name in schemas, f"{schema_name} is not defined in openapi.yaml"
        schema = {**registry_root, **schemas[schema_name]}
        try:
            jsonschema.validate(instance=payload, schema=schema)
        except jsonschema.ValidationError as exc:  # pragma: no cover - failure path
            location = "/".join(str(part) for part in exc.absolute_path) or "<root>"
            pytest.fail(
                f"Response does not satisfy openapi.yaml #/components/schemas/{schema_name}\n"
                f"  at: {location}\n"
                f"  problem: {exc.message}"
            )

    return _assert


@pytest.fixture(scope="session")
def schema_properties(openapi_spec):
    """The declared property names of a component schema, `allOf` flattened."""

    def _properties(schema_name: str) -> set[str]:
        schemas = openapi_spec["components"]["schemas"]
        names: set[str] = set()

        def walk(node: dict[str, Any]) -> None:
            if "$ref" in node:
                walk(schemas[node["$ref"].rsplit("/", 1)[-1]])
            for branch in node.get("allOf", []):
                walk(branch)
            names.update(node.get("properties", {}))

        walk(schemas[schema_name])
        return names

    return _properties
