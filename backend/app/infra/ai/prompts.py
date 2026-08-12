"""Shared prompt templates, text processing, and response parsing for AI providers.

Consolidates prompt templates, base64 image encoding, markdown fence stripping,
and JSON parsing in one domain-specific module.
"""

from __future__ import annotations

import base64
import json
import math
from pathlib import Path

from app.infra.ai.base import ReportResult, ScreenResult


def clean_json_text(raw_text: str) -> str:
    """Strip markdown code block wrappers if model returns ```json ... ```."""
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def encode_image_base64(path: str) -> tuple[str, str]:
    """Read local photo file and return (mime_type, base64_string)."""
    photo_path = Path(path)
    if not photo_path.exists():
        raise FileNotFoundError(f"Photo path does not exist: {path}")

    mime_type = "image/png" if photo_path.suffix.lower() == ".png" else "image/jpeg"
    with open(photo_path, "rb") as f:
        b64_img = base64.b64encode(f.read()).decode("utf-8")
    return mime_type, b64_img


# --- Prompts ------------------------------------------------------------------

VISION_SYSTEM_PROMPT = (
    "You are an objective municipal civic auditor for Kartavya, "
    "a complaint management platform. "
    "Your task is to analyze evidence photos uploaded by citizens and verify "
    "if they visually match the reported complaint category.\n\n"
    "Respond ONLY with a valid JSON object matching this schema:\n"
    "{\n"
    '  "matches_category": true,\n'
    '  "confidence": 0.85,\n'
    '  "note": "Brief explanation of visual evidence observed."\n'
    "}\n"
    "Do NOT include markdown formatting or code fences."
)


def get_vision_user_prompt(category: str) -> str:
    return (
        f"Please inspect this photo and verify if it matches the complaint category: '{category}'."
    )


REPORT_SYSTEM_PROMPT = (
    "You are a senior municipal urban analytics expert for Kartavya.\n"
    "Your task is to synthesize aggregated zone complaint metrics "
    "into a structured civic health report.\n\n"
    "Respond ONLY with a valid JSON object matching this schema:\n"
    "{\n"
    '  "summary": "High-level overview of zone civic health and resolution progress.",\n'
    '  "trends": "Key patterns, rising complaint types, or bottleneck areas.",\n'
    '  "hotspots": "Critical concern areas based on volume and category distribution.",\n'
    '  "suggestions": "Actionable recommendations for municipal officers."\n'
    "}\n"
    "Do NOT include markdown formatting or code fences."
)


def get_report_user_prompt(stats: dict) -> str:
    zone_name = stats.get("zone_name", "Unknown Zone")
    total = stats.get("total_complaints", 0)
    open_c = stats.get("open_complaints", 0)
    resolved = stats.get("resolved_complaints", 0)

    return (
        f"Zone: {zone_name}\n"
        f"Total Complaints: {total}\n"
        f"Open Complaints: {open_c}\n"
        f"Resolved Complaints: {resolved}\n\n"
        "Please generate the civic health summary report."
    )


# --- Parsers ------------------------------------------------------------------


def parse_screen_result(raw_text: str) -> ScreenResult:
    """Parse raw model output text into ScreenResult."""
    clean_text = clean_json_text(raw_text)
    parsed = json.loads(clean_text)
    if not isinstance(parsed, dict):
        raise ValueError(f"Invalid model JSON output: expected dict, got {type(parsed).__name__}")

    raw_matches = parsed.get("matches_category")
    if not isinstance(raw_matches, bool):
        raise ValueError("matches_category must be a boolean")

    raw_conf = parsed.get("confidence")
    if isinstance(raw_conf, bool) or not isinstance(raw_conf, (int, float)):
        raise ValueError("confidence must be a number")

    conf_float = float(raw_conf)
    if math.isnan(conf_float) or math.isinf(conf_float):
        raise ValueError("confidence must be a finite number")
    if not (0.0 <= conf_float <= 1.0):
        raise ValueError("confidence must be between 0.0 and 1.0")

    raw_note = parsed.get("note", "")
    if not isinstance(raw_note, str):
        raise ValueError("note must be a string")

    return ScreenResult(
        matches_category=raw_matches,
        confidence=conf_float,
        note=raw_note,
    )


def parse_report_result(raw_text: str) -> ReportResult:
    """Parse raw model output text into ReportResult."""
    clean_text = clean_json_text(raw_text)
    parsed = json.loads(clean_text)
    if not isinstance(parsed, dict):
        raise ValueError(f"Invalid model JSON output: expected dict, got {type(parsed).__name__}")

    required_keys = ("summary", "trends", "hotspots", "suggestions")
    for key in required_keys:
        val = parsed.get(key)
        if not isinstance(val, str) or not val.strip():
            raise ValueError(f"Invalid report model JSON: '{key}' must be a non-empty string")

    return ReportResult(
        summary=parsed["summary"],
        trends=parsed["trends"],
        hotspots=parsed["hotspots"],
        suggestions=parsed["suggestions"],
    )
