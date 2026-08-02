"""Unit tests for RemoteApiProvider (Phase 8)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app.infra.ai import build_provider
from app.infra.ai.prompts import clean_json_text
from app.infra.ai.remote import RemoteApiProvider


def test_clean_json_text():
    raw_markdown = "```json\n{\n  \"key\": \"value\"\n}\n```"
    assert clean_json_text(raw_markdown) == "{\n  \"key\": \"value\"\n}"

    raw_plain = "{\"key\": \"value\"}"
    assert clean_json_text(raw_plain) == "{\"key\": \"value\"}"


def test_remote_provider_missing_api_key_raises(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    provider = RemoteApiProvider(api_key="")
    with pytest.raises(ValueError, match="AI_API_KEY is not configured"):
        provider.screen_photo(str(img_file), "Potholes")


def test_remote_provider_screen_photo_success(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    mock_resp_data = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "matches_category": True,
                            "confidence": 0.92,
                            "note": "Visual evidence confirms pothole.",
                        }
                    )
                }
            }
        ]
    }

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(mock_resp_data).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    provider = RemoteApiProvider(api_key="test_key")

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = provider.screen_photo(str(img_file), "Potholes")

    assert res is not None
    assert res.matches_category is True
    assert res.confidence == 0.92
    assert "pothole" in res.note


def test_remote_provider_zone_report_success():
    report_json_str = (
        "```json\n"
        "{\n"
        '  "summary": "Zone health is good.",\n'
        '  "trends": "Streetlights flat.",\n'
        '  "hotspots": "Market area.",\n'
        '  "suggestions": "Inspect drains."\n'
        "}\n"
        "```"
    )
    mock_resp_data = {"choices": [{"message": {"content": report_json_str}}]}

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(mock_resp_data).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    provider = RemoteApiProvider(api_key="test_key")

    stats = {
        "zone_name": "Zone 1",
        "total_complaints": 10,
        "open_complaints": 2,
        "resolved_complaints": 8,
    }

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = provider.zone_report(stats)

    assert res is not None
    assert res.summary == "Zone health is good."
    assert res.trends == "Streetlights flat."
    assert res.hotspots == "Market area."
    assert res.suggestions == "Inspect drains."


def test_remote_provider_guarded_fallback(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    # Build guarded provider with remote backend and no API key
    guarded = build_provider(
        "remote",
        timeout_seconds=5.0,
        failure_threshold=3,
        cooldown_seconds=30.0,
    )
    # Guarded provider catches missing API key exception and returns None
    res = guarded.screen_photo(str(img_file), "Potholes")
    assert res is None


def test_remote_provider_empty_json_raises_value_error(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    mock_resp_data = {"choices": [{"message": {"content": "{}"}}]}
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(mock_resp_data).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    provider = RemoteApiProvider(api_key="test_key")

    with patch("urllib.request.urlopen", return_value=mock_resp), pytest.raises(
        ValueError, match="matches_category must be a boolean"
    ):
        provider.screen_photo(str(img_file), "Potholes")


def test_remote_provider_invalid_types_raise_value_error(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    # string bool "false"
    mock_resp1 = MagicMock()
    mock_resp1.read.return_value = json.dumps(
        {"choices": [{"message": {"content": '{"matches_category": "false", "confidence": 0.8}'}}]}
    ).encode("utf-8")
    mock_resp1.__enter__.return_value = mock_resp1

    provider = RemoteApiProvider(api_key="test_key")
    with patch("urllib.request.urlopen", return_value=mock_resp1), pytest.raises(
        ValueError, match="matches_category must be a boolean"
    ):
        provider.screen_photo(str(img_file), "Potholes")

    # NaN float
    mock_resp2 = MagicMock()
    mock_resp2.read.return_value = json.dumps(
        {"choices": [{"message": {"content": '{"matches_category": true, "confidence": "NaN"}'}}]}
    ).encode("utf-8")
    mock_resp2.__enter__.return_value = mock_resp2

    with patch("urllib.request.urlopen", return_value=mock_resp2), pytest.raises(
        ValueError, match="confidence must be a number"
    ):
        provider.screen_photo(str(img_file), "Potholes")

    # Array field in zone report
    mock_resp3 = MagicMock()
    mock_resp3.read.return_value = json.dumps(
        {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": ["item1"],
                                "trends": "T",
                                "hotspots": "H",
                                "suggestions": "S",
                            }
                        )
                    }
                }
            ]
        }
    ).encode("utf-8")
    mock_resp3.__enter__.return_value = mock_resp3

    with patch("urllib.request.urlopen", return_value=mock_resp3), pytest.raises(
        ValueError, match="must be a non-empty string"
    ):
        provider.zone_report(
            {
                "zone_name": "Z1",
                "total_complaints": 1,
                "open_complaints": 1,
                "resolved_complaints": 0,
            }
        )
