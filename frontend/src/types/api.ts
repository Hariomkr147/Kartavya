/**
 * Friendly aliases over the raw openapi-typescript output (api.generated.ts),
 * whose schema types live under `components["schemas"][Name]`. Regenerate
 * api.generated.ts with `npm run gen:types`; add an alias here for any new
 * schema this codebase needs to reference by name.
 */
import type { components } from "./api.generated";

type Schemas = components["schemas"];

export type Role = Schemas["Role"];
export type StatusActor = Schemas["StatusActor"];
export type ComplaintStatus = Schemas["ComplaintStatus"];
export type OfficerTargetStatus = Schemas["OfficerTargetStatus"];
export type SeverityLabel = Schemas["SeverityLabel"];
export type SlaLabel = Schemas["SlaLabel"];
export type EvidenceVerdict = Schemas["EvidenceVerdict"];
export type DisputeVerdict = Schemas["DisputeVerdict"];

export type ApiError = Schemas["Error"];
export type PaginationMeta = Schemas["PaginationMeta"];

export type User = Schemas["User"];
export type AuthResponse = Schemas["AuthResponse"];
export type RegisterRequest = Schemas["RegisterRequest"];
export type LoginRequest = Schemas["LoginRequest"];
export type UpdateProfileRequest = Schemas["UpdateProfileRequest"];
export type ChangePasswordRequest = Schemas["ChangePasswordRequest"];
export type CreateUserRequest = Schemas["CreateUserRequest"];
export type UpdateUserRequest = Schemas["UpdateUserRequest"];
export type UserListResponse = Schemas["UserListResponse"];

export type Category = Schemas["Category"];
export type Zone = Schemas["Zone"];
export type CreateZoneRequest = Schemas["CreateZoneRequest"];
export type UpdateZoneRequest = Schemas["UpdateZoneRequest"];
export type ZoneSuggestionRequest = Schemas["ZoneSuggestionRequest"];
export type ZoneSuggestionResponse = Schemas["ZoneSuggestionResponse"];
export type AssignOfficerRequest = Schemas["AssignOfficerRequest"];
export type SlaUpdateRequest = Schemas["SlaUpdateRequest"];
export type Settings = Schemas["Settings"];

export type Complaint = Schemas["Complaint"];
export type ComplaintDetail = Schemas["ComplaintDetail"];
export type ComplaintListResponse = Schemas["ComplaintListResponse"];
export type CreateComplaintRequest = Schemas["CreateComplaintRequest"];
export type SubmitEvidenceRequest = Schemas["SubmitEvidenceRequest"];
export type EvidenceReviewRequest = Schemas["EvidenceReviewRequest"];
export type StatusUpdateRequest = Schemas["StatusUpdateRequest"];
export type StatusUpdateResult = Schemas["StatusUpdateResult"];
export type BatchStatusUpdateRequest = Schemas["BatchStatusUpdateRequest"];
export type BatchStatusUpdateResult = Schemas["BatchStatusUpdateResult"];
export type TransitionFailureCode = Schemas["TransitionFailureCode"];
export type ProgressNoteRequest = Schemas["ProgressNoteRequest"];
export type ProgressNote = Schemas["ProgressNote"];
export type DisputeRequest = Schemas["DisputeRequest"];
export type DisputeReviewRequest = Schemas["DisputeReviewRequest"];
export type UpvoteResult = Schemas["UpvoteResult"];
export type ComplaintOverrideRequest = Schemas["ComplaintOverrideRequest"];
export type Evidence = Schemas["Evidence"];
export type AiConfidenceNote = Schemas["AiConfidenceNote"];
export type StatusHistoryEntry = Schemas["StatusHistoryEntry"];

export type FeedItem = Schemas["FeedItem"];
export type FeedListResponse = Schemas["FeedListResponse"];

export type Cluster = Schemas["Cluster"];
export type ClusterDetail = Schemas["ClusterDetail"];
export type ClusterListResponse = Schemas["ClusterListResponse"];
export type ZoneSummary = Schemas["ZoneSummary"];

export type PointsLedgerEntry = Schemas["PointsLedgerEntry"];
export type PointsSummary = Schemas["PointsSummary"];
export type Badge = Schemas["Badge"];
export type LeaderboardEntry = Schemas["LeaderboardEntry"];
export type LeaderboardResponse = Schemas["LeaderboardResponse"];

export type CategoryBreakdownItem = Schemas["CategoryBreakdownItem"];
export type ZoneAnalytics = Schemas["ZoneAnalytics"];
export type ZoneMetrics = Schemas["ZoneMetrics"];
export type SystemAnalytics = Schemas["SystemAnalytics"];
export type OfficerPerformance = Schemas["OfficerPerformance"];
export type PublicOfficerStats = Schemas["PublicOfficerStats"];

export type AiZoneReport = Schemas["AiZoneReport"];
