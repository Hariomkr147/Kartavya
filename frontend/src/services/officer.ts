import { apiFetch, type QueryParams } from "./http";
import type {
  BatchStatusUpdateRequest,
  BatchStatusUpdateResult,
  ComplaintDetail,
  ComplaintListResponse,
  ComplaintStatus,
  EvidenceReviewRequest,
  ProgressNote,
  ProgressNoteRequest,
  SeverityLabel,
  SlaLabel,
  StatusUpdateRequest,
  StatusUpdateResult,
  ZoneAnalytics,
} from "@/types/api";

export interface GetOfficerQueueParams extends QueryParams {
  status?: ComplaintStatus[];
  categoryId?: string;
  slaLabel?: SlaLabel;
  severityLabel?: SeverityLabel;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function getOfficerQueue(
  params: GetOfficerQueueParams = {},
): Promise<ComplaintListResponse> {
  return apiFetch<ComplaintListResponse>("/officer/complaints", { query: params });
}

export function claimComplaint(complaintId: string): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/officer/complaints/${complaintId}/claim`, {
    method: "POST",
  });
}

export function reviewEvidence(
  complaintId: string,
  body: EvidenceReviewRequest,
): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/officer/complaints/${complaintId}/evidence-review`, {
    method: "POST",
    body,
  });
}

export function updateComplaintStatus(
  complaintId: string,
  body: StatusUpdateRequest,
): Promise<StatusUpdateResult> {
  return apiFetch<StatusUpdateResult>(`/officer/complaints/${complaintId}/status`, {
    method: "PATCH",
    body,
  });
}

export function batchUpdateStatus(
  body: BatchStatusUpdateRequest,
): Promise<BatchStatusUpdateResult> {
  return apiFetch<BatchStatusUpdateResult>("/officer/complaints/batch-status", {
    method: "POST",
    body,
  });
}

export function addProgressNote(
  complaintId: string,
  body: ProgressNoteRequest,
): Promise<ProgressNote> {
  return apiFetch<ProgressNote>(`/officer/complaints/${complaintId}/notes`, {
    method: "POST",
    body,
  });
}

export function addClusterProgressNote(
  clusterId: string,
  body: ProgressNoteRequest,
): Promise<ProgressNote[]> {
  return apiFetch<ProgressNote[]>(`/officer/clusters/${clusterId}/notes`, {
    method: "POST",
    body,
  });
}

export interface GetOfficerAnalyticsParams extends QueryParams {
  dateFrom?: string;
  dateTo?: string;
}

export function getOfficerAnalytics(
  params: GetOfficerAnalyticsParams = {},
): Promise<ZoneAnalytics> {
  return apiFetch<ZoneAnalytics>("/officer/analytics", { query: params });
}
