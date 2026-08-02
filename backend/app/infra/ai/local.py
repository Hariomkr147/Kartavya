"""Local AI model provider (Phase 8).

Connects to a local model runner (e.g. Ollama or local LLM HTTP endpoint).
Uses shared prompts, base64 encoding, and response parsers from `app.infra.ai.common`.
Wrapped by `GuardedProvider` so exceptions (server down, timeout, malformed JSON)
safely evaluate to `None` without impacting routes or jobs.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

from app.infra.ai.base import ReportResult, ScreenResult
from app.infra.ai.prompts import (
    REPORT_SYSTEM_PROMPT,
    VISION_SYSTEM_PROMPT,
    encode_image_base64,
    get_report_user_prompt,
    get_vision_user_prompt,
    parse_report_result,
    parse_screen_result,
)

logger = logging.getLogger(__name__)


class LocalModelProvider:
    def __init__(
        self,
        local_url: str | None = None,
        vision_model: str | None = None,
        text_model: str | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._local_url = (
            local_url or os.environ.get("AI_LOCAL_URL", "http://localhost:11434")
        ).rstrip("/")
        self._vision_model = vision_model or os.environ.get("AI_LOCAL_VISION_MODEL", "llava")
        self._text_model = text_model or os.environ.get("AI_LOCAL_TEXT_MODEL", "llama3")
        self._timeout_seconds = timeout_seconds

    def _send_generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        endpoint = f"{self._local_url}/api/generate"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self._timeout_seconds) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as err:
            error_body = err.read().decode("utf-8", errors="ignore")
            logger.error("Local AI HTTP error %d: %s", err.code, error_body)
            raise RuntimeError(f"Local AI returned HTTP status {err.code}") from err
        except Exception as err:
            logger.error("Local AI server request failed: %s", err)
            raise

    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        """Screen a photo using local vision model."""
        _, b64_img = encode_image_base64(path)
        prompt = f"{VISION_SYSTEM_PROMPT}\n\n{get_vision_user_prompt(category)}"

        payload = {
            "model": self._vision_model,
            "prompt": prompt,
            "images": [b64_img],
            "stream": False,
        }

        resp_json = self._send_generate(payload)
        raw_text = resp_json.get("response", "")
        return parse_screen_result(raw_text)

    def zone_report(self, stats: dict) -> ReportResult | None:
        """Synthesize zone health statistics using local text LLM."""
        prompt = f"{REPORT_SYSTEM_PROMPT}\n\n{get_report_user_prompt(stats)}"

        payload = {
            "model": self._text_model,
            "prompt": prompt,
            "stream": False,
        }

        resp_json = self._send_generate(payload)
        raw_text = resp_json.get("response", "")
        return parse_report_result(raw_text)
