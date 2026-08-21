"""Cover app/infra/storage_supabase.py against a mocked Storage REST API.

No real network call in this file — every test patches `urllib.request.urlopen`
so these stay in the fast, offline unit-test tier. The one thing worth pinning
down here that a live call would also prove is the *contract* with Supabase's
API: POST to upload, GET to download (404 -> None, not an exception), DELETE
with a `{"prefixes": [...]}` body to remove, and the service_role key going out
as both `apikey` and `Authorization: Bearer` on every request.
"""

from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.infra import storage_supabase as storage


@pytest.fixture
def app():
    application = Flask(__name__)
    application.config.update(
        SUPABASE_URL="https://project-ref.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="service-role-secret",
        SUPABASE_STORAGE_BUCKET="evidence-photos",
    )
    return application


def _fake_response(body: bytes):
    response = MagicMock()
    response.read.return_value = body
    response.__enter__.return_value = response
    response.__exit__.return_value = False
    return response


def test_store_photo_posts_to_the_object_endpoint_and_returns_the_key(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.return_value = _fake_response(b'{"Key":"ignored"}')

        key = storage.store_photo(
            complaint_id=42, stream=BytesIO(b"photo-bytes"), mime_type="image/jpeg"
        )

    assert key.startswith("42/")
    assert key.endswith(".jpg")

    request = urlopen.call_args[0][0]
    assert (
        request.full_url
        == f"https://project-ref.supabase.co/storage/v1/object/evidence-photos/{key}"
    )
    assert request.get_method() == "POST"
    assert request.get_header("Apikey") == "service-role-secret"
    assert request.get_header("Authorization") == "Bearer service-role-secret"
    assert request.get_header("Content-type") == "image/jpeg"
    assert request.get_header("X-upsert") == "true"
    assert request.data == b"photo-bytes"


def test_store_photo_picks_the_png_extension_for_png(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.return_value = _fake_response(b"{}")
        key = storage.store_photo(complaint_id=1, stream=BytesIO(b"x"), mime_type="image/png")
    assert key.endswith(".png")


def test_store_photo_raises_on_an_http_error(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.HTTPError(
            url="x", code=413, msg="Payload Too Large", hdrs=None, fp=BytesIO(b"too big")
        )
        with pytest.raises(RuntimeError, match="413"):
            storage.store_photo(complaint_id=1, stream=BytesIO(b"x"), mime_type="image/jpeg")


def test_store_photo_raises_when_supabase_is_unreachable(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.URLError("connection refused")
        with pytest.raises(RuntimeError):
            storage.store_photo(complaint_id=1, stream=BytesIO(b"x"), mime_type="image/jpeg")


def test_store_photo_requires_configuration():
    app = Flask(__name__)  # no SUPABASE_* keys set
    with app.app_context(), pytest.raises(RuntimeError, match="SUPABASE_URL"):
        storage.store_photo(complaint_id=1, stream=BytesIO(b"x"), mime_type="image/jpeg")


def test_read_bytes_returns_the_downloaded_body(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.return_value = _fake_response(b"\xff\xd8\xff-jpeg-bytes")
        data = storage.read_bytes(file_path="42/abc.jpg")

    assert data == b"\xff\xd8\xff-jpeg-bytes"
    request = urlopen.call_args[0][0]
    assert (
        request.full_url
        == "https://project-ref.supabase.co/storage/v1/object/evidence-photos/42/abc.jpg"
    )
    assert request.get_method() == "GET"


def test_read_bytes_returns_none_on_a_404(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.HTTPError(
            url="x", code=404, msg="Not Found", hdrs=None, fp=BytesIO(b"")
        )
        assert storage.read_bytes(file_path="missing/nope.jpg") is None


def test_read_bytes_returns_none_on_a_server_error(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.HTTPError(
            url="x", code=500, msg="Internal Server Error", hdrs=None, fp=BytesIO(b"")
        )
        assert storage.read_bytes(file_path="42/abc.jpg") is None


def test_read_bytes_returns_none_when_unreachable(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.URLError("connection refused")
        assert storage.read_bytes(file_path="42/abc.jpg") is None


def test_remove_photo_sends_a_delete_with_a_prefixes_body(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.return_value = _fake_response(b"{}")
        storage.remove_photo(file_path="42/abc.jpg")

    request = urlopen.call_args[0][0]
    assert request.full_url == "https://project-ref.supabase.co/storage/v1/object/evidence-photos"
    assert request.get_method() == "DELETE"
    assert json.loads(request.data) == {"prefixes": ["42/abc.jpg"]}


def test_remove_photo_is_best_effort_and_never_raises(app):
    with app.app_context(), patch("urllib.request.urlopen") as urlopen:
        urlopen.side_effect = urllib.error.HTTPError(
            url="x", code=500, msg="Internal Server Error", hdrs=None, fp=BytesIO(b"")
        )
        storage.remove_photo(file_path="42/abc.jpg")  # must not raise


def test_remove_photo_is_a_no_op_without_configuration():
    app = Flask(__name__)
    with app.app_context():
        storage.remove_photo(file_path="42/abc.jpg")  # must not raise
