"""Request models for the endpoints shared by officers and admins."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ClusterListQuery(BaseModel):
    """openapi.yaml: GET /clusters parameters.

    `zoneId` is documented "Admin only" — an officer is already confined to
    their own zone by `scoping.visible_clusters`, and the service rejects an
    officer who names a different one rather than quietly returning nothing.
    """

    model_config = ConfigDict(extra="forbid")

    zoneId: int | None = Field(default=None, gt=0)
    page: int | None = Field(default=1, ge=1)
    pageSize: int | None = Field(default=20, ge=1, le=100)
