"""Cover app/infra/storage.py's STORAGE_PROVIDER dispatch.

The local backend already gets heavy indirect coverage through
tests/api/test_complaint_actions.py and the integration journeys, which all
run with the default STORAGE_PROVIDER=local. Nothing in the existing suite
ever sets STORAGE_PROVIDER=supabase, so that is the one behaviour worth
pinning down directly here: store/remove/read must delegate to
app.infra.storage_supabase rather than touching disk at all.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

import pytest
from flask import Flask

from app.infra import storage


@pytest.fixture
def supabase_app(tmp_path):
    application = Flask(__name__)
    application.config.update(STORAGE_PROVIDER="supabase", UPLOAD_DIR=tmp_path)
    return application


@pytest.fixture
def local_app(tmp_path):
    application = Flask(__name__)
    application.config.update(STORAGE_PROVIDER="local", UPLOAD_DIR=tmp_path)
    return application


def test_store_photo_delegates_to_supabase_when_configured(supabase_app, tmp_path):
    with (
        supabase_app.app_context(),
        patch(
            "app.infra.storage_supabase.store_photo", return_value="7/generated-key.jpg"
        ) as remote_store,
    ):
        key = storage.store_photo(
            complaint_id=7, stream=BytesIO(b"bytes"), mime_type="image/jpeg", upload_dir=tmp_path
        )

    assert key == "7/generated-key.jpg"
    remote_store.assert_called_once()
    _, kwargs = remote_store.call_args
    assert kwargs["complaint_id"] == 7
    assert kwargs["mime_type"] == "image/jpeg"
    # Nothing was written to disk — the whole point of delegating.
    assert list(tmp_path.rglob("*")) == []


def test_store_photo_stays_local_by_default(local_app, tmp_path):
    with local_app.app_context(), patch("app.infra.storage_supabase.store_photo") as remote_store:
        key = storage.store_photo(
            complaint_id=7,
            stream=BytesIO(b"\xff\xd8\xffjpeg"),
            mime_type="image/jpeg",
            upload_dir=tmp_path,
        )

    remote_store.assert_not_called()
    assert (tmp_path / key).exists()


def test_remove_photo_delegates_to_supabase_when_configured(supabase_app, tmp_path):
    with (
        supabase_app.app_context(),
        patch("app.infra.storage_supabase.remove_photo") as remote_remove,
    ):
        storage.remove_photo(file_path="7/x.jpg", upload_dir=tmp_path)

    remote_remove.assert_called_once_with(file_path="7/x.jpg")


def test_read_photo_bytes_delegates_to_supabase_when_configured(supabase_app, tmp_path):
    with (
        supabase_app.app_context(),
        patch("app.infra.storage_supabase.read_bytes", return_value=b"photo-bytes") as remote_read,
    ):
        data = storage.read_photo_bytes(file_path="7/x.jpg", upload_dir=tmp_path)

    assert data == b"photo-bytes"
    remote_read.assert_called_once_with(file_path="7/x.jpg")


def test_read_photo_bytes_reads_from_disk_locally(local_app, tmp_path):
    target_dir = tmp_path / "7"
    target_dir.mkdir()
    (target_dir / "x.jpg").write_bytes(b"local-bytes")

    with local_app.app_context():
        data = storage.read_photo_bytes(file_path="7/x.jpg", upload_dir=tmp_path)

    assert data == b"local-bytes"


def test_read_photo_bytes_returns_none_for_a_missing_local_file(local_app, tmp_path):
    with local_app.app_context():
        assert storage.read_photo_bytes(file_path="7/missing.jpg", upload_dir=tmp_path) is None


def test_read_photo_bytes_returns_none_for_path_traversal(local_app, tmp_path):
    with local_app.app_context():
        assert storage.read_photo_bytes(file_path="../outside.jpg", upload_dir=tmp_path) is None
