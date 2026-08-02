import pytest
from unittest import mock
from datetime import datetime, timezone
from app.domain.enums import ComplaintStatus, UserRole
from app.models import Complaint, User, ComplaintNote
from app.domain.errors import ValidationError, ConflictError
import app.api.officer.routes
import app.core.auth

@pytest.fixture
def mock_db_session():
    with mock.patch("app.api.officer.routes.db.session") as session:
        yield session

@pytest.fixture
def mock_current_user():
    with mock.patch("app.api.officer.routes.current_user") as cu:
        user = User(id=1, zone_id=1)
        cu.return_value = user
        yield cu

@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer fake_token"}

@pytest.fixture(autouse=True)
def mock_load_user():
    with mock.patch("app.core.auth.load_current_user") as mock_load:
        def side_effect():
            from flask import g
            user = User(id=1, zone_id=1, role=UserRole.OFFICER)
            g.current_user = user
            return user
        mock_load.side_effect = side_effect
        yield mock_load

def test_officer_queue_visibility(client, auth_headers, mock_db_session, mock_current_user):
    # Mock the database execute call for get_complaints
    c = Complaint(
        id=100, 
        complaint_code="TEST1", 
        citizen_id=1, 
        category_id=1, 
        zone_id=1,
        latitude=12.0, 
        longitude=77.0, 
        status=ComplaintStatus.SUBMITTED,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
        severity_score=1,
        sla_paused_seconds=0
    )
    
    # Mocking select().where(...) chaining
    call_count = [0]
    def mock_execute(*args, **kwargs):
        call_count[0] += 1
        class _Res:
            def scalar_one(self): return 1
            def all(self): return []
            def scalars(self):
                class _S:
                    def all(self): return [c] if call_count[0] == 2 else []
                    def __iter__(self): return iter([c] if call_count[0] == 2 else [])
                return _S()
        return _Res()
        
    mock_db_session.execute.side_effect = mock_execute

    resp = client.get("/api/v1/officer/complaints", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json["data"]
    assert len(data) == 1
    assert data[0]["id"] == "100"
    assert "reporter" not in data[0]

def test_claim_complaint(client, auth_headers, mock_current_user):
    with mock.patch("app.api.officer.routes.lifecycle.claim") as mock_claim:
        mock_claim.return_value = Complaint(
            id=100, 
            status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
            sla_paused_seconds=0,
            severity_score=1,
            latitude=12.0,
            longitude=77.0
        )
        resp = client.post("/api/v1/officer/complaints/100/claim", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json
        assert data["status"] == "EVIDENCE_UNDER_REVIEW"
        assert "reporter" not in data
        assert mock_claim.called

def test_evidence_review_valid(client, auth_headers, mock_current_user):
    with mock.patch("app.api.officer.routes.lifecycle.review_evidence") as mock_review:
        mock_review.return_value = Complaint(
            id=100, 
            status=ComplaintStatus.UNDER_REVIEW,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
            sla_target_hours=72,
            sla_started_at=datetime.now(timezone.utc).replace(tzinfo=None),
            sla_paused_seconds=0,
            severity_score=1,
            latitude=12.0,
            longitude=77.0
        )
        resp = client.post(
            "/api/v1/officer/complaints/100/evidence-review",
            json={"verdict": "VALID"},
            headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json["status"] == "UNDER_REVIEW"
        assert "reporter" not in resp.json
        assert mock_review.called

def test_evidence_review_missing_reason(client, auth_headers, mock_current_user):
    with mock.patch("app.api.officer.routes.lifecycle.review_evidence") as mock_review:
        mock_review.side_effect = ValidationError("Reason is required.", code="REASON_REQUIRED")
        resp = client.post(
            "/api/v1/officer/complaints/100/evidence-review",
            json={"verdict": "NEEDS_MORE_EVIDENCE"}, 
            headers=auth_headers
        )
        assert resp.status_code == 400

def test_status_update_resolved(client, auth_headers, mock_current_user):
    with mock.patch("app.api.officer.routes.lifecycle.transition_by_officer") as mock_trans:
        import types
        c = Complaint(
            id=100, 
            status=ComplaintStatus.RESOLVED,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
            sla_paused_seconds=0,
            severity_score=1,
            latitude=12.0,
            longitude=77.0
        )
        mock_trans.return_value = types.SimpleNamespace(complaint=c, cascade=[])
        resp = client.patch(
            "/api/v1/officer/complaints/100/status",
            json={"status": "RESOLVED"},
            headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json["complaint"]["status"] == "RESOLVED"
        assert "reporter" not in resp.json["complaint"]


def test_public_officer_stats(client, auth_headers):
    with mock.patch("app.api.officer.routes.analytics_officer.public_officer_stats") as mock_stats:
        mock_stats.return_value = {"officerId": "1", "totalResolved": 0}
        resp = client.get("/api/v1/officers/1/stats", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json["officerId"] == "1"
        assert resp.json["totalResolved"] == 0

def test_status_update_unresolvable_requires_reason(client, auth_headers, mock_current_user):
    with mock.patch("app.api.officer.routes.lifecycle.transition_by_officer") as mock_trans:
        mock_trans.side_effect = ValidationError("Reason is required.", code="REASON_REQUIRED")
        resp = client.patch(
            "/api/v1/officer/complaints/100/status",
            json={"status": "UNRESOLVABLE"}, 
            headers=auth_headers
        )
        assert resp.status_code == 400
