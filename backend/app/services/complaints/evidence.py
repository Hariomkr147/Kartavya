"""Evidence row sequencing and verdict recording.

`complaint_evidence` is append-only: INSERT a new row per photo, never update or
delete a historical one. The single documented exception is the verdict block
(`verdict`, `verdict_reason`, `reviewed_by`, `reviewed_at`), which is null until
an officer reviews that row and is written exactly once.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.domain.enums import EvidenceVerdict
from app.models import ComplaintEvidence, User


def next_sequence(*, complaint_id: int) -> int:
    """MAX(sequence) + 1 for this complaint.

    TODO(phase 3). 1..N are the originals; N+1 onward are re-submissions and
    dispute photos. The unique (complaint_id, sequence) index is the backstop —
    compute this inside the same transaction as the insert.
    """
    raise NotImplementedError


def attach_photos(
    *, complaint_id: int, photos: list[Any], now: datetime
) -> list[ComplaintEvidence]:
    """Validate, persist to disk, and insert one evidence row per photo.

    TODO(phase 3). Delegates the file work to `infra/storage.py` (magic-byte
    check, size limit, UUID filename outside the web root) and stores only the
    relative path. Never store the client's filename, and never the bytes.

    Each new row starts at ai_screen_status=PENDING and gets its own
    fire-and-forget screening job — a 3-photo complaint spawns 3 jobs.
    """
    raise NotImplementedError


def record_verdict(
    *,
    evidence_id: int,
    officer: User,
    verdict: EvidenceVerdict,
    reason: str | None,
    now: datetime,
) -> ComplaintEvidence:
    """Stamp an officer's ruling onto the evidence row it judged.

    TODO(phase 4). `reason` is mandatory for NEEDS_MORE_EVIDENCE and REJECTED —
    the domain check has already enforced that by the time this runs.

    A dispute-evidence row NEVER passes through here: its verdict stays
    permanently null, because the admin judges that photo directly when ruling
    on the dispute, and the ruling lives on status_history.
    """
    raise NotImplementedError


def latest_reviewable(*, complaint_id: int) -> ComplaintEvidence | None:
    """The evidence row an officer's verdict should attach to.

    TODO(phase 4). The highest-sequence row that is not dispute evidence.
    """
    raise NotImplementedError
