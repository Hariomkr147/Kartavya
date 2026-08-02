"""Unit tests for LocalModelProvider (Phase 8)."""

from __future__ import annotations

import json
import urllib.error
from unittest.mock import MagicMock, patch

from app.infra.ai import build_provider
from app.infra.ai.local import LocalModelProvider


def test_local_provider_screen_photo_success(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    mock_resp_data = {
        "response": json.dumps(
            {
                "matches_category": True,
                "confidence": 0.87,
                "note": "Pothole visible on road surface.",
            }
        )
    }

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(mock_resp_data).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    provider = LocalModelProvider(local_url="http://localhost:11434")

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = provider.screen_photo(str(img_file), "Potholes")

    assert res is not None
    assert res.matches_category is True
    assert res.confidence == 0.87
    assert "Pothole" in res.note


def test_local_provider_zone_report_success():
    report_json_str = (
        "```json\n"
        "{\n"
        '  "summary": "Local zone health is normal.",\n'
        '  "trends": "Drainage issues flat.",\n'
        '  "hotspots": "Central avenue.",\n'
        '  "suggestions": "Clear culverts."\n'
        "}\n"
        "```"
    )
    mock_resp_data = {"response": report_json_str}

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(mock_resp_data).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    provider = LocalModelProvider(local_url="http://localhost:11434")

    stats = {
        "zone_name": "Zone 2",
        "total_complaints": 15,
        "open_complaints": 3,
        "resolved_complaints": 12,
    }

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = provider.zone_report(stats)

    assert res is not None
    assert res.summary == "Local zone health is normal."
    assert res.trends == "Drainage issues flat."
    assert res.hotspots == "Central avenue."
    assert res.suggestions == "Clear culverts."


def test_local_provider_guarded_fallback_on_connection_error(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0test")

    guarded = build_provider(
        "local",
        timeout_seconds=5.0,
        failure_threshold=3,
        cooldown_seconds=30.0,
    )

    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        res = guarded.screen_photo(str(img_file), "Potholes")

    assert res is None
