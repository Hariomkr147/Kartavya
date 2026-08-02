from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from flask import Flask

from app.domain.enums import ComplaintStatus, PointsReason
from app.domain.errors import Ok
from app.models import Complaint, User
from app.services.complaints.lifecycle import confirm_resolution, dispute_resolution


@patch("app.services.complaints.lifecycle.load_complaint_detail")
@patch("app.services.complaints.lifecycle.evaluate_and_award")
@patch("app.services.complaints.lifecycle.award")
@patch("app.services.complaints.lifecycle.claim_cluster_reward", return_value=True)
@patch(
    "app.services.complaints.lifecycle.citizen_already_rewarded_in_cluster",
    return_value=False,
)
@patch("app.services.complaints.lifecycle.apply_transition")
@patch("app.services.complaints.lifecycle.db.session")
def test_confirm_resolution(
    mock_session,
    mock_apply,
    _mock_already_rewarded,
    _mock_claim_cluster,
    mock_award,
    mock_evaluate,
    mock_load_detail,
):
    now = datetime.now(UTC)
    citizen = User(id=1)
    complaint = Complaint(
        id=10,
        citizen_id=1,
        status=ComplaintStatus.RESOLVED,
        cluster_id=5,
        sla_target_hours=72,
        sla_started_at=now,
        sla_paused_seconds=0,
    )
    detail = object()
    mock_session.get.return_value = complaint
    mock_apply.return_value = complaint
    mock_load_detail.return_value = detail

    with patch("app.services.complaints.lifecycle.validate_confirm", return_value=Ok()):
        result = confirm_resolution(complaint_id=10, citizen=citizen, now=now)

    mock_apply.assert_called_once()
    mock_award.assert_any_call(
        citizen_id=1,
        complaint_id=10,
        reason=PointsReason.COMPLAINT_CLOSED,
        now=now,
    )
    mock_evaluate.assert_called_once_with(citizen_id=1, now=now)
    assert result is detail


@patch("app.jobs.screening.submit_evidence_screening")
@patch("app.services.complaints.lifecycle.load_complaint_detail")
@patch("app.services.complaints.lifecycle.attach_photos")
@patch("app.services.complaints.lifecycle.apply_transition")
@patch("app.services.complaints.lifecycle.db.session")
def test_dispute_resolution(
    mock_session,
    mock_apply,
    mock_attach,
    mock_load_detail,
    mock_submit_screening,
):
    now = datetime.now(UTC)
    citizen = User(id=1)
    complaint = Complaint(id=10, citizen_id=1, status=ComplaintStatus.RESOLVED)
    evidence = MagicMock(id=44)
    detail = object()
    photo = MagicMock()
    mock_session.get.return_value = complaint
    mock_attach.return_value = [evidence]
    mock_load_detail.return_value = detail

    app = Flask(__name__)
    app.config["UPLOAD_DIR"] = "/tmp"
    with app.app_context(), patch(
        "app.services.complaints.lifecycle.validate_dispute", return_value=Ok()
    ):
        result = dispute_resolution(
            complaint_id=10,
            citizen=citizen,
            reason="still broken",
            photo=photo,
            now=now,
        )

    mock_apply.assert_called_once()
    mock_attach.assert_called_once_with(complaint_id=10, photos=[photo], now=now)
    mock_submit_screening.assert_called_once()
    assert result is detail
