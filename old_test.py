import pytest
from datetime import datetime, timezone, timedelta
from app.models import Complaint, User, ComplaintEvidence, ComplaintCategory, Zone, StatusHistory, ComplaintNote
from app.domain.enums import UserRole, ComplaintStatus, EvidenceVerdict
from app.extensions import db


@pytest.fixture
def citizen(app):
    with app.app_context():
        # Setup zones and categories first
        z1 = Zone(id=1, zone_code="Z1", zone_name="Zone 1", center_lat=0.0, center_lng=0.0, is_active=True, is_catch_all=False)
        z2 = Zone(id=2, zone_code="Z2", zone_name="Zone 2", center_lat=0.0, center_lng=0.0, is_active=True, is_catch_all=False)
        db.session.add_all([z1, z2])
        
        c_cat = ComplaintCategory(id=1, category_code="POT", category_name="Pothole", sla_hours=24)
        db.session.add(c_cat)

        u = User(
            email="citizen@test.com",
            password_hash="hash",
            full_name="Citizen",
            display_name="Cit",
            role=UserRole.CITIZEN,
            zone_id=1,
            is_active=True
        )
        db.session.add(u)
        db.session.commit()
        return u.id


@pytest.fixture
def officer(app, citizen):
    # Depending on citizen ensures the zones and categories are created first
    with app.app_context():
        u = User(
            email="officer@test.com",
            password_hash="hash",
            full_name="Officer",
            role=UserRole.OFFICER,
            zone_id=1,
            is_active=True
        )
        db.session.add(u)
        db.session.commit()
        return u.id


@pytest.fixture
def other_officer(app, citizen):
    with app.app_context():
        u = User(
            email="other@test.com",
            password_hash="hash",
            full_name="Other Officer",
            role=UserRole.OFFICER,
            zone_id=2,  # Different zone
            is_active=True
        )
        db.session.add(u)
        db.session.commit()
        return u.id


@pytest.fixture
def auth_headers(client, officer):
    # Mocking JWT token logic for officer
    from app.core.auth import issue_token
    with client.application.app_context():
        u = db.session.get(User, officer)
        token, _ = issue_token(u)
        return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def base_complaint(app, citizen):
    with app.app_context():
        c = Complaint(
            citizen_id=citizen,
            complaint_code="TEST1",
            category_id=1,
            zone_id=1,
            latitude=12.0,
            longitude=77.0,
            status=ComplaintStatus.SUBMITTED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            severity_score=1
        )
        db.session.add(c)
        db.session.commit()
        return c.id


def test_officer_queue_visibility(client, auth_headers, base_complaint, app, citizen):
    # Create another complaint in zone 2
    with app.app_context():
        c = Complaint(
            citizen_id=citizen,
            complaint_code="TEST2",
            category_id=1,
            zone_id=2, # different zone
            latitude=12.0,
            longitude=77.0,
            status=ComplaintStatus.SUBMITTED,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            severity_score=1
        )
        db.session.add(c)
        db.session.commit()

    resp = client.get("/api/v1/officer/complaints", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json["data"]
    assert len(data) == 1
    assert data[0]["id"] == str(base_complaint)
    
    # Privacy check
    assert "reporter" not in data[0]


def test_claim_complaint(client, auth_headers, base_complaint, officer):
    resp = client.post(f"/api/v1/officer/complaints/{base_complaint}/claim", headers=auth_headers)
    assert resp.status_code == 200
    
    data = resp.json
    assert data["status"] == "EVIDENCE_UNDER_REVIEW"
    assert "reporter" not in data
    
    # Claiming twice should return 409
    resp = client.post(f"/api/v1/officer/complaints/{base_complaint}/claim", headers=auth_headers)
    assert resp.status_code == 409


def test_evidence_review_valid(client, auth_headers, base_complaint, app):
    # Setup state
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.EVIDENCE_UNDER_REVIEW
        ev = ComplaintEvidence(
            complaint_id=base_complaint,
            sequence=1,
            file_path="test.jpg",
            created_at=datetime.now(timezone.utc)
        )
        db.session.add(ev)
        db.session.commit()

    resp = client.post(
        f"/api/v1/officer/complaints/{base_complaint}/evidence-review",
        json={"verdict": "VALID"},
        headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json["status"] == "UNDER_REVIEW"
    assert "reporter" not in resp.json
    assert resp.json["slaLabel"] is not None


def test_evidence_review_missing_reason(client, auth_headers, base_complaint, app):
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.EVIDENCE_UNDER_REVIEW
        db.session.commit()

    # NEEDS_MORE_EVIDENCE requires reason per lifecycle rules
    resp = client.post(
        f"/api/v1/officer/complaints/{base_complaint}/evidence-review",
        json={"verdict": "NEEDS_MORE_EVIDENCE"}, # missing reason
        headers=auth_headers
    )
    # The domain rule throws 400 REASON_REQUIRED
    assert resp.status_code == 400


def test_status_update_resolved(client, auth_headers, base_complaint, app):
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.UNDER_RESOLUTION
        db.session.commit()

    resp = client.patch(
        f"/api/v1/officer/complaints/{base_complaint}/status",
        json={"status": "RESOLVED"},
        headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json["complaint"]["status"] == "RESOLVED"
    assert "reporter" not in resp.json["complaint"]
    assert "cascade" not in resp.json  # Standalone


def test_add_progress_note(client, auth_headers, base_complaint, app, officer):
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.IN_PROGRESS
        db.session.commit()

    resp = client.post(
        f"/api/v1/officer/complaints/{base_complaint}/notes",
        json={"text": "Fixed the issue."},
        headers=auth_headers
    )
    assert resp.status_code == 201
    assert resp.json["text"] == "Fixed the issue."
    assert resp.json["officerId"] == str(officer)
    assert "reporter" not in resp.json


def test_public_officer_stats(client, officer, auth_headers):
    resp = client.get(f"/api/v1/officers/{officer}/stats", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json["officerId"] == str(officer)
    assert resp.json["totalResolved"] == 0


def test_status_update_with_note(client, auth_headers, base_complaint, app):
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.UNDER_RESOLUTION
        db.session.commit()

    resp = client.patch(
        f"/api/v1/officer/complaints/{base_complaint}/status",
        json={"status": "RESOLVED", "note": "Closing remark"},
        headers=auth_headers
    )
    assert resp.status_code == 200
    # Check that remark is in statusHistory
    histories = resp.json["complaint"]["statusHistory"]
    assert histories[-1]["toStatus"] == "RESOLVED"
    assert histories[-1].get("remark") == "Closing remark"


def test_status_update_unresolvable_requires_reason(client, auth_headers, base_complaint, app):
    with app.app_context():
        c = db.session.get(Complaint, base_complaint)
        c.status = ComplaintStatus.UNDER_RESOLUTION
        db.session.commit()

    resp = client.patch(
        f"/api/v1/officer/complaints/{base_complaint}/status",
        json={"status": "UNRESOLVABLE"}, # missing reason
        headers=auth_headers
    )
    assert resp.status_code == 400
