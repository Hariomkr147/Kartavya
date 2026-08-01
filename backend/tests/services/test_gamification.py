from unittest.mock import patch, MagicMock
import pytest
from datetime import datetime, UTC

from app.domain.enums import PointsReason, ComplaintStatus
from app.services.gamification.ledger import award, lifetime_points, monthly_points
from app.services.gamification.badges import gather_stats
from app.domain.badges import CitizenStats

@patch('app.services.gamification.ledger.db.session')
@patch('app.services.gamification.badges.evaluate_and_award')
def test_award_ledger(mock_evaluate, mock_session):
    now = datetime.now(UTC)
    award(citizen_id=1, complaint_id=10, reason=PointsReason.COMPLAINT_CLOSED, now=now)
    
    mock_session.add.assert_called_once()
    mock_session.flush.assert_called_once()
    mock_evaluate.assert_called_once_with(citizen_id=1, now=now)
    
    added_obj = mock_session.add.call_args[0][0]
    assert added_obj.points_change == 50
    assert added_obj.reason == PointsReason.COMPLAINT_CLOSED

@patch('app.services.gamification.badges.db.session')
@patch('app.services.gamification.leaderboard.zone_rank')
def test_gather_stats(mock_zone_rank, mock_session):
    mock_session.scalar.side_effect = [5, 3, 100]  # filed, closed, pts
    mock_zone_rank.return_value = 1
    
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [datetime.now(UTC)]
    mock_session.scalars.return_value = mock_scalars
    
    stats = gather_stats(citizen_id=1)
    assert stats.complaints_filed == 5
    assert stats.complaints_closed == 3
    assert stats.lifetime_points == 100
    assert stats.is_zone_rank_one is True
    assert len(stats.closed_at_timestamps) == 1
