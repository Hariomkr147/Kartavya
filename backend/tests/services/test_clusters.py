from unittest import mock
import pytest
from datetime import datetime, timezone
from app.models import ComplaintCluster, Complaint, ComplaintUpvote
from app.domain.enums import ComplaintStatus
from app.services.complaints import clusters

@mock.patch("app.services.complaints.clusters.db")
@mock.patch("app.services.complaints.clusters.recompute_cluster_aggregates")
def test_link_new_complaint_creates_cluster(mock_recompute, mock_db):
    c1 = Complaint(
        id=1,
        complaint_code="TEST-1",
        citizen_id=10,
        zone_id=20,
        category_id=30,
        latitude=51.5072,
        longitude=-0.1276,
        description="Test 1",
        status=ComplaintStatus.SUBMITTED,
        severity_score=0,
        cluster_id=None
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Mock nearby candidate
    c2 = Complaint(
        id=2, latitude=51.5072, longitude=-0.1276, cluster_id=None
    )
    
    class MockResult:
        def __init__(self, items):
            self.items = items
        def scalars(self):
            outer = self.items
            class _S:
                def all(self):
                    return outer
            return _S()

    mock_db.session.execute.return_value = MockResult([c2])
    
    def mock_flush():
        for obj in mock_db.session.add.call_args_list:
            if isinstance(obj.args[0], ComplaintCluster):
                obj.args[0].id = 99
    mock_db.session.flush.side_effect = mock_flush
    
    clusters.link_new_complaint(complaint=c1, radius_meters=100.0, now=now)
    
    assert c1.cluster_id == 99
    assert mock_db.session.add.called
    assert mock_recompute.called

@mock.patch("app.services.complaints.clusters.db")
@mock.patch("app.services.complaints.clusters.recompute_cluster_aggregates")
def test_link_new_complaint_joins_existing_cluster(mock_recompute, mock_db):
    c1 = Complaint(
        id=1,
        complaint_code="TEST-1",
        citizen_id=10,
        zone_id=20,
        category_id=30,
        latitude=51.5072,
        longitude=-0.1276,
        description="Test 1",
        status=ComplaintStatus.SUBMITTED,
        severity_score=0,
        cluster_id=None
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    c2 = Complaint(
        id=2, latitude=51.5072, longitude=-0.1276, cluster_id=99
    )
    cl = ComplaintCluster(id=99, centroid_lat=51.5072, centroid_lng=-0.1276)
    
    class MockResult:
        def __init__(self, items):
            self.items = items
        def scalars(self):
            outer = self.items
            class _S:
                def all(self):
                    return outer
            return _S()
            
    def mock_execute(*args, **kwargs):
        query_str = str(args[0])
        if "complaint_cluster" in query_str:
            return MockResult([cl])
        return MockResult([c2])
        
    mock_db.session.execute.side_effect = mock_execute
    
    clusters.link_new_complaint(complaint=c1, radius_meters=100.0, now=now)
    
    assert c1.cluster_id == 99
    assert mock_recompute.called

@mock.patch("app.services.complaints.clusters.db")
def test_recompute_cluster_aggregates(mock_db):
    c1 = Complaint(id=1, citizen_id=10, latitude=51.0, longitude=-0.1, severity_score=0)
    c2 = Complaint(id=2, citizen_id=11, latitude=51.0, longitude=-0.1, severity_score=0)
    cluster = ComplaintCluster(id=99, category_id=30, zone_id=20)
    
    mock_db.session.get.return_value = cluster
    
    class MockResult:
        def __init__(self, items):
            self.items = items
        def scalars(self):
            outer = self.items
            class _S:
                def all(self):
                    return outer
            return _S()
        def scalar(self):
            return 0
            
    call_count = [0]
    def mock_execute(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return MockResult([c1, c2])
        return MockResult([])

    mock_db.session.execute.side_effect = mock_execute
    
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    clusters.recompute_cluster_aggregates(cluster_id=99, now=now)
    
    assert cluster.report_count == 2
    assert cluster.unique_reporter_count == 2
