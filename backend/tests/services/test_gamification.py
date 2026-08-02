from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from app.domain.enums import PointsReason
from app.models import User
from app.services.gamification.badges import gather_stats
from app.services.gamification.ledger import award


@patch("app.services.gamification.ledger.db.session")
@patch("app.services.gamification.badges.evaluate_and_award")
def test_award_ledger(mock_evaluate, mock_session):
    now = datetime.now(UTC)
    award(
        citizen_id=1,
        complaint_id=10,
        reason=PointsReason.COMPLAINT_CLOSED,
        now=now,
    )

    added_obj = mock_session.add.call_args.args[0]
    assert added_obj.points_change == 50
    assert added_obj.reason is PointsReason.COMPLAINT_CLOSED
    mock_session.flush.assert_called_once()
    mock_evaluate.assert_called_once_with(citizen_id=1, now=now)


@patch("app.services.gamification.badges.db.session")
def test_gather_stats(mock_session):
    now = datetime.now(UTC)
    mock_session.get.return_value = User(id=1, zone_id=7)

    filed = MagicMock()
    filed.scalar_one.return_value = 5
    closed = MagicMock()
    closed.scalars.return_value = [now, now, now]
    points = MagicMock()
    points.scalar_one.return_value = 100
    zone_leader = MagicMock()
    zone_leader.scalars.return_value = [1]
    mock_session.execute.side_effect = [filed, closed, points, zone_leader]

    stats = gather_stats(citizen_id=1)

    assert stats.complaints_filed == 5
    assert stats.complaints_closed == 3
    assert stats.lifetime_points == 100
    assert stats.is_zone_rank_one is True
    assert len(stats.closed_at_timestamps) == 3
