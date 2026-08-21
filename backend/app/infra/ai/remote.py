"""Remote HTTP REST API AI provider (Phase 8).

Implements `AiProvider` using an external API endpoint (e.g., OpenAI / Gemini API).
Uses shared prompts, base64 encoding, and response parsers from `app.infra.ai.common`.
Wrapped by `GuardedProvider` so exceptions (missing key, network failure, malformed JSON)
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


class RemoteApiProvider:
    def __init__(
        self,
        api_key: str | None = None,
        api_url: str | None = None,
        model_name: str | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("AI_API_KEY", "")
        self._api_url = api_url or os.environ.get(
            "AI_API_URL", "https://api.openai.com/v1/chat/completions"
        )
        self._model_name = model_name or os.environ.get("AI_MODEL_NAME", "gpt-4o-mini")
        self._timeout_seconds = timeout_seconds

    def _send_request(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self._api_key:
            raise ValueError("AI_API_KEY is not configured")

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self._api_url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self._timeout_seconds) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as err:
            error_body = err.read().decode("utf-8", errors="ignore")
            logger.error("AI API HTTP error %d: %s", err.code, error_body)
            raise RuntimeError(f"AI API returned HTTP status {err.code}") from err
        except Exception as err:
            logger.error("AI API request failed: %s", err)
            raise

    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        """Screen a photo using vision API."""
        mime_type, b64_img = encode_image_base64(path)
        data_uri = f"data:{mime_type};base64,{b64_img}"
        user_prompt = get_vision_user_prompt(category)

        payload = {
            "model": self._model_name,
            "messages": [
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ],
                },
            ],
            "temperature": 0.2,
        }

        resp_json = self._send_request(payload)
        raw_text = resp_json["choices"][0]["message"]["content"]
        return parse_screen_result(raw_text)

    def zone_report(self, stats: dict) -> ReportResult | None:
        """Synthesize zone health statistics using LLM."""
        user_prompt = get_report_user_prompt(stats)

        payload = {
            "model": self._model_name,
            "messages": [
                {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
        }

        resp_json = self._send_request(payload)
        raw_text = resp_json["choices"][0]["message"]["content"]
        return parse_report_result(raw_text)
