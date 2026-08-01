from unittest.mock import patch, MagicMock
import pytest
from datetime import datetime, UTC
from flask import Flask

from app.domain.enums import ComplaintStatus, PointsReason
from app.services.complaints.lifecycle import confirm_resolution, dispute_resolution
from app.models import User, Complaint
from app.domain.errors import ConflictError, ForbiddenError
from app.domain.errors import Ok, Err

@patch('app.services.complaints.lifecycle.db.session')
@patch('app.services.complaints.lifecycle.apply_transition')
@patch('app.services.complaints.lifecycle.record_history')
@patch('app.services.complaints.clusters.claim_cluster_reward')
@patch('app.services.gamification.ledger.award')
def test_confirm_resolution(mock_award, mock_claim_cluster, mock_record, mock_apply, mock_session):
    now = datetime.now(UTC)
    citizen = User(id=1)
    complaint = Complaint(id=10, citizen_id=1, status=ComplaintStatus.RESOLVED, cluster_id=5, sla_target_hours=72, sla_started_at=now, sla_paused_seconds=0, sla_paused_at=None)
    mock_session.get.return_value = complaint
    mock_claim_cluster.return_value = True # Claimed successfully (+50)
    
    mock_session.scalar.return_value = None # Not already rewarded
    
    with patch('app.domain.lifecycle.validate_confirm', return_value=Ok()):
        res = confirm_resolution(complaint_id=10, citizen=citizen, now=now)
    
    mock_apply.assert_called_once()
    mock_record.assert_called_once()
    mock_award.assert_any_call(citizen_id=1, complaint_id=10, reason=PointsReason.COMPLAINT_CLOSED, now=now)
    
    assert res == complaint

@patch('app.services.complaints.lifecycle.db.session')
@patch('app.services.complaints.lifecycle.apply_transition')
@patch('app.services.complaints.lifecycle.record_history')
@patch('app.infra.storage.validate_photo')
@patch('app.infra.storage.store_photo')
def test_dispute_resolution(mock_store_photo, mock_validate_photo, mock_record, mock_apply, mock_session):
    now = datetime.now(UTC)
    citizen = User(id=1)
    complaint = Complaint(id=10, citizen_id=1, status=ComplaintStatus.RESOLVED)
    mock_session.get.return_value = complaint
    mock_session.scalar.return_value = 0 # next_seq
    
    mock_validate_photo.return_value = 'image/jpeg'
    mock_store_photo.return_value = 'some_path.jpg'
    
    mock_photo = MagicMock()
    mock_photo.stream = b'abc'
    mock_photo.mimetype = 'image/jpeg'
    
    app = Flask(__name__)
    app.config['UPLOAD_DIR'] = '/tmp'
    
    with app.app_context():
        with patch('app.domain.lifecycle.validate_dispute', return_value=Ok()):
            res = dispute_resolution(complaint_id=10, citizen=citizen, reason="still broken", photo=mock_photo, now=now)
    
    mock_store_photo.assert_called_once()
    mock_apply.assert_called_once()
    mock_record.assert_called_once()
    
    assert res == complaint
