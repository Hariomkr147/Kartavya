import { apiFetch, type QueryParams } from "./http";
import type {
  ComplaintDetail,
  ComplaintListResponse,
  ComplaintStatus,
  UpvoteResult,
} from "@/types/api";

export interface GetMyComplaintsParams extends QueryParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  status?: ComplaintStatus[];
  categoryId?: string;
}

export function getMyComplaints(
  params: GetMyComplaintsParams = {},
): Promise<ComplaintListResponse> {
  return apiFetch<ComplaintListResponse>("/complaints/my", { query: params });
}

export function getComplaintById(complaintId: string): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/complaints/${complaintId}`);
}

export interface CreateComplaintInput {
  categoryId: string;
  description?: string;
  /** 1 to 3 photos per the contract — each becomes its own evidence record. */
  photos: File[];
  latitude: number;
  longitude: number;
  zoneId: string;
  categorySuggestedByAi: boolean;
}

export function createComplaint(input: CreateComplaintInput): Promise<ComplaintDetail> {
  const form = new FormData();
  form.set("categoryId", input.categoryId);
  if (input.description) form.set("description", input.description);
  for (const photo of input.photos) form.append("photos", photo);
  form.set("latitude", String(input.latitude));
  form.set("longitude", String(input.longitude));
  form.set("zoneId", input.zoneId);
  form.set("categorySuggestedByAi", String(input.categorySuggestedByAi));
  return apiFetch<ComplaintDetail>("/complaints", { method: "POST", formData: form });
}

export function submitAdditionalEvidence(
  complaintId: string,
  photo: File,
): Promise<ComplaintDetail> {
  const form = new FormData();
  form.set("photo", photo);
  return apiFetch<ComplaintDetail>(`/complaints/${complaintId}/evidence`, {
    method: "POST",
    formData: form,
  });
}

export function upvoteComplaint(complaintId: string): Promise<UpvoteResult> {
  return apiFetch<UpvoteResult>(`/complaints/${complaintId}/upvote`, { method: "POST" });
}

export function confirmResolution(complaintId: string): Promise<ComplaintDetail> {
  return apiFetch<ComplaintDetail>(`/complaints/${complaintId}/confirm`, {
    method: "POST",
  });
}

export function disputeResolution(
  complaintId: string,
  reason: string,
  photo: File,
): Promise<ComplaintDetail> {
  const form = new FormData();
  form.set("reason", reason);
  form.set("photo", photo);
  return apiFetch<ComplaintDetail>(`/complaints/${complaintId}/dispute`, {
    method: "POST",
    formData: form,
  });
}
