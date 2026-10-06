"""Admin-only cross-zone management, analytics, and export endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, Response, current_app, jsonify, stream_with_context

from app.api.admin.schemas import (
    AdminResetPasswordRequest,
    AssignOfficerRequest,
    ComplaintOverrideRequest,
    ComplaintQuery,
    CreateUserRequest,
    CreateZoneRequest,
    DisputeReviewRequest,
    ExportComplaintsQuery,
    OfficerPerformanceQuery,
    SettingsRequest,
    SlaUpdateRequest,
    UpdateUserRequest,
    UpdateZoneRequest,
    UserQuery,
)
from app.api.admin.serializers import (
    serialize_complaint_for_admin,
    serialize_managed_user,
)
from app.api.shared.serializers import (
    SerializationContext,
    serialize_category,
    serialize_complaint,
    serialize_zone,
)
from app.core.auth import current_user, require_role
from app.core.validation import validate_body, validate_query
from app.domain.enums import ComplaintStatus, UserRole
from app.services.accounts.settings import (
    get_settings as get_settings_service,
)
from app.services.accounts.settings import (
    update_category_sla,
)
from app.services.accounts.settings import (
    update_settings as update_settings_service,
)
from app.services.accounts.users import (
    create_user as create_user_service,
)
from app.services.accounts.users import (
    delete_user as delete_user_service,
)
from app.services.accounts.users import (
    get_user as get_user_service,
)
from app.services.accounts.users import (
    list_users,
    reassign_officer_zone,
)
from app.services.accounts.users import (
    reset_password as reset_password_service,
)
from app.services.accounts.users import (
    update_user as update_user_service,
)
from app.services.accounts.zones import (
    create_zone as create_zone_service,
)
from app.services.accounts.zones import (
    delete_zone as delete_zone_service,
)
from app.services.accounts.zones import (
    update_zone as update_zone_service,
)
from app.services.analytics.export import generate_complaints_csv_service
from app.services.analytics.officer import officer_performance
from app.services.analytics.system import system_analytics
from app.services.complaints.admin_views import (
    AdminComplaintData,
    list_admin_complaints,
    load_admin_complaint,
)
from app.services.complaints.lifecycle import override, review_dispute

bp = Blueprint("admin", __name__)
ADMIN = UserRole.ADMIN


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _naive(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _statuses(
    value: list[ComplaintStatus] | ComplaintStatus | None,
) -> list[ComplaintStatus] | None:
    if value is None:
        return None
    return value if isinstance(value, list) else [value]


def _context(data: AdminComplaintData) -> SerializationContext:
    return SerializationContext(
        now=data.now,
        categories=data.categories,
        zones=data.zones,
        users=data.users,
        upvote_counts=data.upvote_counts,
        first_evidence=data.first_evidence,
        evidence_rows=data.evidence_rows,
        history_rows=data.history_rows,
        note_rows=data.note_rows,
    )


@bp.get("/admin/complaints")
@require_role(ADMIN)
@validate_query(ComplaintQuery)
def get_all_complaints(query: ComplaintQuery):
    now = _utcnow()
    page = list_admin_complaints(
        zone_id=query.zoneId,
        category_id=query.categoryId,
        statuses=_statuses(query.status),
        sla_label=query.slaLabel,
        date_from=_naive(query.dateFrom),
        date_to=_naive(query.dateTo),
        sort=query.sort,
        page=query.page,
        page_size=query.pageSize,
        now=now,
    )
    ctx = _context(page.data)
    return jsonify(
        {
            "data": [serialize_complaint(row, ctx) for row in page.complaints],
            "pagination": page.pagination.to_dict(),
        }
    )


@bp.patch("/admin/complaints/<int:complaint_id>")
@require_role(ADMIN)
@validate_body(ComplaintOverrideRequest)
def override_complaint(complaint_id: int, body: ComplaintOverrideRequest):
    now = _utcnow()
    override(
        complaint_id=complaint_id,
        admin=current_user(),
        new_status=body.status,
        new_zone_id=body.zoneId,
        new_category_id=body.categoryId,
        reason=body.reason.strip() if body.reason else None,
        now=now,
        cluster_radius_meters=current_app.config["CLUSTER_RADIUS_METERS"],
    )
    complaint, data = load_admin_complaint(complaint_id=complaint_id, now=now)
    return jsonify(serialize_complaint_for_admin(complaint, _context(data)))


@bp.post("/admin/complaints/<int:complaint_id>/dispute-review")
@require_role(ADMIN)
@validate_body(DisputeReviewRequest)
def review_complaint_dispute(complaint_id: int, body: DisputeReviewRequest):
    now = _utcnow()
    review_dispute(
        complaint_id=complaint_id,
        admin=current_user(),
        verdict=body.verdict,
        reason=body.reason.strip(),
        now=now,
    )
    complaint, data = load_admin_complaint(complaint_id=complaint_id, now=now)
    return jsonify(serialize_complaint_for_admin(complaint, _context(data)))


@bp.get("/admin/users")
@require_role(ADMIN)
@validate_query(UserQuery)
def get_all_users(query: UserQuery):
    users, pagination = list_users(
        role=query.role,
        zone_id=query.zoneId,
        active=query.active,
        page=query.page,
        page_size=query.pageSize,
    )
    return jsonify(
        {
            "data": [serialize_managed_user(user) for user in users],
            "pagination": pagination.to_dict(),
        }
    )


@bp.post("/admin/users")
@require_role(ADMIN)
@validate_body(CreateUserRequest)
def create_user(body: CreateUserRequest):
    user = create_user_service(
        full_name=body.name,
        email=str(body.email),
        password=body.password,
        role=UserRole(body.role.value),
        zone_id=body.zoneId,
    )
    return jsonify(serialize_managed_user(user)), 201


@bp.get("/admin/users/<int:user_id>")
@require_role(ADMIN)
def get_user_by_id(user_id: int):
    return jsonify(serialize_managed_user(get_user_service(user_id=user_id)))


@bp.patch("/admin/users/<int:user_id>")
@require_role(ADMIN)
@validate_body(UpdateUserRequest)
def update_user(user_id: int, body: UpdateUserRequest):
    user = update_user_service(
        user_id=user_id,
        acting_admin_id=current_user().id,
        full_name=body.name,
        email=str(body.email) if body.email is not None else None,
        zone_id=body.zoneId,
        change_zone="zoneId" in body.model_fields_set,
        active=body.active,
    )
    return jsonify(serialize_managed_user(user))


@bp.delete("/admin/users/<int:user_id>")
@require_role(ADMIN)
def delete_user(user_id: int):
    delete_user_service(user_id=user_id, acting_admin_id=current_user().id)
    return Response(status=204)


@bp.post("/admin/users/<int:user_id>/reset-password")
@require_role(ADMIN)
@validate_body(AdminResetPasswordRequest)
def reset_user_password(user_id: int, body: AdminResetPasswordRequest):
    """204. Admin sets a password directly — no current-password check."""
    reset_password_service(user_id=user_id, new_password=body.newPassword)
    return Response(status=204)


@bp.post("/admin/users/<int:user_id>/mfa-reset")
@require_role(ADMIN)
def reset_user_mfa(user_id: int):
    """204. Clears a user's two-step verification (lost device). Idempotent."""
    from app.services.accounts.mfa import service as mfa

    mfa.admin_reset(user_id)
    return Response(status=204)


@bp.post("/admin/zones")
@require_role(ADMIN)
@validate_body(CreateZoneRequest)
def create_zone(body: CreateZoneRequest):
    zone = create_zone_service(
        zone_code=body.code,
        zone_name=body.name,
        center_lat=body.centerLat,
        center_lng=body.centerLng,
    )
    return jsonify(serialize_zone(zone)), 201


@bp.patch("/admin/zones/<int:zone_id>")
@require_role(ADMIN)
@validate_body(UpdateZoneRequest)
def update_zone(zone_id: int, body: UpdateZoneRequest):
    zone = update_zone_service(
        zone_id=zone_id,
        zone_name=body.name,
        center_lat=None,
        center_lng=None,
        is_active=body.isActive,
    )
    return jsonify(serialize_zone(zone))


@bp.delete("/admin/zones/<int:zone_id>")
@require_role(ADMIN)
def delete_zone(zone_id: int):
    delete_zone_service(zone_id=zone_id)
    return Response(status=204)


@bp.post("/admin/zones/<int:zone_id>/assign-officer")
@require_role(ADMIN)
@validate_body(AssignOfficerRequest)
def assign_officer_to_zone(zone_id: int, body: AssignOfficerRequest):
    return jsonify(
        serialize_managed_user(reassign_officer_zone(officer_id=body.officerId, zone_id=zone_id))
    )


@bp.patch("/admin/slas/<int:category_id>")
@require_role(ADMIN)
@validate_body(SlaUpdateRequest)
def update_sla(category_id: int, body: SlaUpdateRequest):
    return jsonify(
        serialize_category(
            update_category_sla(category_id=category_id, sla_target_hours=body.targetHours)
        )
    )


@bp.get("/admin/settings")
@require_role(ADMIN)
def get_settings():
    settings = get_settings_service()
    return jsonify({"autoCloseTimeoutHours": settings.auto_close_timeout_hours})


@bp.patch("/admin/settings")
@require_role(ADMIN)
@validate_body(SettingsRequest)
def update_settings(body: SettingsRequest):
    settings = update_settings_service(
        admin=current_user(), auto_close_timeout_hours=body.autoCloseTimeoutHours
    )
    return jsonify({"autoCloseTimeoutHours": settings.auto_close_timeout_hours})


@bp.get("/admin/analytics")
@require_role(ADMIN)
def get_system_analytics():
    return jsonify(system_analytics(now=_utcnow()))


@bp.get("/admin/officers/<int:officer_id>/performance")
@require_role(ADMIN)
@validate_query(OfficerPerformanceQuery)
def get_officer_performance(officer_id: int, query: OfficerPerformanceQuery):
    return jsonify(
        officer_performance(
            officer_id=officer_id,
            period=query.period.value,
            date_from=_naive(query.dateFrom),
            date_to=_naive(query.dateTo),
            now=_utcnow(),
        )
    )


@bp.get("/admin/export/complaints")
@require_role(ADMIN)
@validate_query(ExportComplaintsQuery)
def export_complaints_csv(query: ExportComplaintsQuery):
    generator = generate_complaints_csv_service(
        zone_id=query.zoneId,
        category_id=query.categoryId,
        statuses=_statuses(query.status),
        sla_label=query.slaLabel,
        date_from=_naive(query.dateFrom),
        date_to=_naive(query.dateTo),
        now=_utcnow(),
    )
    return Response(
        stream_with_context(generator),
        mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="complaints.csv"'},
    )


@bp.post("/admin/zones/<int:zone_id>/ai-report")
@require_role(ADMIN)
def generate_ai_zone_report(zone_id: int):
    """202 Accepted — kick off async generation of an AI zone health report."""
    from app.api.admin.serializers import serialize_ai_zone_report
    from app.services.analytics.zone import request_ai_zone_report

    report = request_ai_zone_report(
        zone_id=zone_id,
        admin_user=current_user(),
        now=datetime.now(UTC),
    )
    return jsonify(serialize_ai_zone_report(report)), 202


@bp.get("/admin/zones/<int:zone_id>/ai-report")
@require_role(ADMIN)
def get_ai_zone_report(zone_id: int):
    """200 AiZoneReport — the latest stored report, or 404 if none exists."""
    from app.api.admin.serializers import serialize_ai_zone_report
    from app.services.analytics.zone import get_latest_ai_zone_report

    report = get_latest_ai_zone_report(zone_id=zone_id)
    return jsonify(serialize_ai_zone_report(report))
