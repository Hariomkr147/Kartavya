"""The app boots, the URL map matches the contract, and errors have one shape."""

from __future__ import annotations

import pytest

from app.settings import API_PREFIX


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_health_is_not_under_the_api_prefix(app):
    """It is not in openapi.yaml, so it must not live under /api/v1.

    The contract tests validate everything under that prefix against the
    contract; an undocumented endpoint there would be a violation on its own.
    """
    rules = {rule.rule for rule in app.url_map.iter_rules()}
    assert "/health" in rules
    assert f"{API_PREFIX}/health" not in rules


def test_unknown_path_uses_the_error_envelope(client):
    """A client must never have to parse two different error shapes."""
    response = client.get(f"{API_PREFIX}/definitely-not-a-real-endpoint")
    assert response.status_code == 404
    body = response.get_json()
    assert set(body) == {"error"}
    assert "code" in body["error"]
    assert "message" in body["error"]


def test_protected_endpoint_without_a_token_is_401(client):
    response = client.get(f"{API_PREFIX}/complaints/my")
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/auth/register"),
        ("POST", "/auth/login"),
        ("GET", "/categories"),
        ("GET", "/zones"),
        ("GET", "/evidence/1/photo"),
    ],
)
def test_the_five_public_operations_do_not_demand_a_token(client, method, path):
    """Exactly five operations are `security: []` in the contract.

    `POST /zones/suggest` is deliberately NOT among them — read the contract's
    security blocks carefully rather than assuming everything next to a public
    lookup is public too.

    These currently answer 501 (unimplemented); what matters here is that they
    never answer 401.
    """
    response = client.open(f"{API_PREFIX}{path}", method=method, json={})
    assert response.status_code != 401


def test_zone_suggest_is_not_public(client):
    response = client.post(f"{API_PREFIX}/zones/suggest", json={})
    assert response.status_code == 401


def test_every_contract_path_is_routed(app):
    """A cheap guard against a path being forgotten entirely.

    Counts only; the contract tests in tests/contract/ check the shapes. Update
    the expected number when the contract changes — a surprise here means either
    a new endpoint arrived or one was dropped.
    """
    api_rules = {rule.rule for rule in app.url_map.iter_rules() if rule.rule.startswith(API_PREFIX)}
    assert len(api_rules) == 51, sorted(api_rules)
