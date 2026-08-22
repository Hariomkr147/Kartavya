import { apiFetch, type QueryParams } from "./http";
import type {
  AdminResetPasswordRequest,
  AiZoneReport,
  AssignOfficerRequest,
  Category,
  ComplaintDetail,
  ComplaintListResponse,
  ComplaintOverrideRequest,
  ComplaintStatus,
  CreateUserRequest,
  CreateZoneRequest,
  DisputeReviewRequest,
  OfficerPerformance,
  Settings,
  SlaLabel,
  SlaUpdateRequest,
  SystemAnalytics,
  UpdateUserRequest,
  UpdateZoneRequest,
  User,
  UserListResponse,
  Zone,
} from "@/types/api";

export interface GetAdminComplaintsParams extends QueryParams {
  zoneId?: string;
  categoryId?: string;
  status?: ComplaintStatus[];
  slaLabel?: SlaLabel;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function getAllComplaints(
  params: GetAdminComplaintsParams = {},
): Promise<ComplaintListResponse> {
  return apiFetch<ComplaintListResponse>("/admin/complaints", { query: params });
}

export function overrideComplaint(
  complaintId: string,
  body: ComplaintOverrideRequest,
): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/admin/complaints/${complaintId}`, {
    method: "PATCH",
    body,
  });
}

export function reviewDispute(
  complaintId: string,
  body: DisputeReviewRequest,
): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/admin/complaints/${complaintId}/dispute-review`, {
    method: "POST",
    body,
  });
}

export type ExportComplaintsParams = Omit<
  GetAdminComplaintsParams,
  "sort" | "page" | "pageSize"
>;

/**
 * Sends only the six filters `exportComplaintsCsv` declares in openapi.yaml.
 *
 * The admin complaints page builds one filter object and feeds it to both the
 * list and the export, and `QueryParams`' index signature means a leftover
 * `sort` key type-checks fine here. The backend validates this query with
 * Pydantic `extra="forbid"` and answers 400 VALIDATION_ERROR; the mock ignores
 * unknown query params, so the export appeared to work in development and
 * failed for every admin in production. Picking the allowed keys here fixes it
 * once, instead of trusting each call site to strip them.
 */
export function exportComplaintsCsv(
  params: ExportComplaintsParams = {},
): Promise<string> {
  const { zoneId, categoryId, status, slaLabel, dateFrom, dateTo } = params;
  return apiFetch<string>("/admin/export/complaints", {
    query: { zoneId, categoryId, status, slaLabel, dateFrom, dateTo },
  });
}

export interface GetAllUsersParams extends QueryParams {
  role?: "CITIZEN" | "OFFICER" | "ADMIN";
  zoneId?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export function getAllUsers(params: GetAllUsersParams = {}): Promise<UserListResponse> {
  return apiFetch<UserListResponse>("/admin/users", { query: params });
}

export function createUser(body: CreateUserRequest): Promise<User> {
  return apiFetch<User>("/admin/users", { method: "POST", body });
}

export function updateUser(userId: string, body: UpdateUserRequest): Promise<User> {
  return apiFetch<User>(`/admin/users/${userId}`, { method: "PATCH", body });
}

export function deleteUser(userId: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${userId}`, { method: "DELETE" });
}

/**
 * Admin-initiated password reset. There is no self-service forgot-password
 * flow, so this is the only way back in for a locked-out account. Does not
 * revoke sessions — see the contract note on the endpoint.
 */
export function resetUserPassword(
  userId: string,
  body: AdminResetPasswordRequest,
): Promise<void> {
  return apiFetch<void>(`/admin/users/${userId}/reset-password`, {
    method: "POST",
    body,
  });
}

export function createZone(body: CreateZoneRequest): Promise<Zone> {
  return apiFetch<Zone>("/admin/zones", { method: "POST", body });
}

export function updateZone(zoneId: string, body: UpdateZoneRequest): Promise<Zone> {
  return apiFetch<Zone>(`/admin/zones/${zoneId}`, { method: "PATCH", body });
}

export function deleteZone(zoneId: string): Promise<void> {
  return apiFetch<void>(`/admin/zones/${zoneId}`, { method: "DELETE" });
}

export function assignOfficerToZone(
  zoneId: string,
  body: AssignOfficerRequest,
): Promise<User> {
  return apiFetch<User>(`/admin/zones/${zoneId}/assign-officer`, {
    method: "POST",
    body,
  });
}

export function updateSla(categoryId: string, body: SlaUpdateRequest): Promise<Category> {
  return apiFetch<Category>(`/admin/slas/${categoryId}`, { method: "PATCH", body });
}

export function getSettings(): Promise<Settings> {
  return apiFetch<Settings>("/admin/settings");
}

export function updateSettings(body: Settings): Promise<Settings> {
  return apiFetch<Settings>("/admin/settings", { method: "PATCH", body });
}

export function getSystemAnalytics(): Promise<SystemAnalytics> {
  return apiFetch<SystemAnalytics>("/admin/analytics");
}

export interface GetOfficerPerformanceParams extends QueryParams {
  period?: "this_month" | "last_month" | "all_time";
  dateFrom?: string;
  dateTo?: string;
}

export function getOfficerPerformance(
  officerId: string,
  params: GetOfficerPerformanceParams = {},
): Promise<OfficerPerformance> {
  return apiFetch<OfficerPerformance>(`/admin/officers/${officerId}/performance`, {
    query: params,
  });
}

export function generateAiZoneReport(zoneId: string): Promise<AiZoneReport> {
  return apiFetch<AiZoneReport>(`/admin/zones/${zoneId}/ai-report`, { method: "POST" });
}

export function getAiZoneReport(zoneId: string): Promise<AiZoneReport> {
  return apiFetch<AiZoneReport>(`/admin/zones/${zoneId}/ai-report`);
}
