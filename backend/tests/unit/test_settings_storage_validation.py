"""Cover the STORAGE_PROVIDER fail-fast checks in ProductionConfig.validate().

Mirrors the existing JWT_SECRET/PHOTO_SIGNING_KEY pattern: a misconfigured
secret must not silently boot into a broken state outside development.
"""

from __future__ import annotations

import pytest

from app.settings import ProductionConfig


def _production_env(monkeypatch, **overrides):
    required = {
        "JWT_SECRET": "a-real-jwt-secret",
        "PHOTO_SIGNING_KEY": "a-different-photo-key",
    }
    for key, value in {**required, **overrides}.items():
        monkeypatch.setenv(key, value)


def test_production_boots_with_the_local_storage_default(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.delenv("STORAGE_PROVIDER", raising=False)
    ProductionConfig().validate()  # must not raise


def test_production_rejects_an_unknown_storage_provider(monkeypatch):
    _production_env(monkeypatch, STORAGE_PROVIDER="s3")
    with pytest.raises(RuntimeError, match="STORAGE_PROVIDER"):
        ProductionConfig().validate()


def test_production_requires_supabase_credentials_when_selected(monkeypatch):
    _production_env(monkeypatch, STORAGE_PROVIDER="supabase")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        ProductionConfig().validate()


def test_production_boots_with_supabase_storage_fully_configured(monkeypatch):
    _production_env(
        monkeypatch,
        STORAGE_PROVIDER="supabase",
        SUPABASE_URL="https://project-ref.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="service-role-secret",
    )
    ProductionConfig().validate()  # must not raise
