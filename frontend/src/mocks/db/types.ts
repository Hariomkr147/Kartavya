/**
 * Internal mock-database row types — mirror backend/database/schema.dbml
 * table-for-table. These are NOT the API response shapes (see ../serializers.ts
 * for DB row -> API DTO mapping); they intentionally carry fields the API
 * hides from some/all callers (citizenId, password, etc.).
 */

export type UserRole = "CITIZEN" | "OFFICER" | "ADMIN";

export type ComplaintStatus =
  | "SUBMITTED"
  | "EVIDENCE_UNDER_REVIEW"
  | "NEEDS_MORE_EVIDENCE"
  | "REJECTED"
  | "UNDER_REVIEW"
  | "IN_PROGRESS"
  | "UNDER_RESOLUTION"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED"
  | "UNRESOLVABLE";

export type SeverityLabel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SlaLabel = "ON_TIME" | "DELAYED" | "OVERDUE";
export type EvidenceVerdict = "VALID" | "NEEDS_MORE_EVIDENCE" | "REJECTED";
export type AiScreenStatus = "PENDING" | "DONE" | "UNAVAILABLE";
export type StatusActor = "CITIZEN" | "OFFICER" | "ADMIN" | "SYSTEM";
export type DisputeVerdict = "UPHELD" | "REJECTED";

export type PointsReason =
  | "COMPLAINT_CLOSED"
  | "CLUSTER_MEMBER_CLOSED"
  | "FIRST_COMPLAINT"
  | "ON_TIME_BONUS"
  | "UPVOTE_RECEIVED"
  | "REJECTED_PENALTY";

export type BadgeCode =
  | "KARTAVYA_INITIATE"
  | "STREET_GUARDIAN"
  | "ZONE_CHAMPION"
  | "CENTURY_REFORMER"
  | "CIVIC_HERO"
  | "SWIFT_REPORTER";

export type BadgeCriteriaType =
  | "FIRST_COMPLAINT"
  | "COMPLAINTS_CLOSED"
  | "LIFETIME_POINTS"
  | "ZONE_RANK_ONE"
  | "CLOSED_WITHIN_DAYS";

export type AiReportStatus = "PENDING" | "READY" | "FAILED";

export interface UserRow {
  id: number;
  fullName: string;
  displayName: string | null;
  email: string;
  /** Mock-only plaintext credential — never a stand-in for real backend auth/hashing. */
  password: string;
  role: UserRole;
  zoneId: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface ZoneRow {
  id: number;
  zoneCode: string;
  zoneName: string;
  centerLat: number;
  centerLng: number;
  isCatchAll: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CategoryRow {
  id: number;
  categoryCode: string;
  categoryName: string;
  description: string | null;
  slaHours: number;
  createdAt: string;
}

export interface ClusterRow {
  id: number;
  categoryId: number;
  zoneId: number;
  centroidLat: number;
  centroidLng: number;
  reportCount: number;
  uniqueReporterCount: number;
  rewardGranted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintRow {
  id: number;
  complaintCode: string;
  citizenId: number;
  zoneId: number;
  categoryId: number;
  clusterId: number | null;
  /** Where clusterId went when this complaint finished — see exitClusterIfTerminal. */
  formerClusterId?: number | null;
  assignedOfficerId: number | null;
  description: string | null;
  categorySuggestedByMatcher: boolean;
  latitude: number;
  longitude: number;
  status: ComplaintStatus;
  severityScore: number;
  slaTargetHours: number | null;
  slaStartedAt: string | null;
  slaPausedSeconds: number;
  slaPausedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface EvidenceRow {
  id: number;
  complaintId: number;
  sequence: number;
  filePath: string;
  aiScreenStatus: AiScreenStatus;
  aiMatchesCategory: boolean | null;
  aiConfidence: number | null;
  aiNote: string | null;
  verdict: EvidenceVerdict | null;
  verdictReason: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface StatusHistoryRow {
  id: number;
  complaintId: number;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  actorRole: StatusActor;
  changedByUserId: number | null;
  reason: string | null;
  remark: string | null;
  createdAt: string;
}

export interface NoteRow {
  id: number;
  complaintId: number;
  officerId: number;
  noteText: string;
  createdAt: string;
}

export interface UpvoteRow {
  id: number;
  complaintId: number;
  citizenId: number;
  createdAt: string;
}

export interface PointsLedgerRow {
  id: number;
  citizenId: number;
  complaintId: number | null;
  pointsChange: number;
  reason: PointsReason;
  createdAt: string;
}

export interface BadgeRow {
  id: number;
  badgeCode: BadgeCode;
  badgeName: string;
  description: string | null;
  criteriaType: BadgeCriteriaType;
  criteriaValue: number | null;
  criteriaCount: number | null;
  createdAt: string;
}

export interface CitizenBadgeRow {
  id: number;
  citizenId: number;
  badgeId: number;
  earnedAt: string;
}

export interface AiZoneReportRow {
  id: number;
  zoneId: number;
  requestedBy: number | null;
  status: AiReportStatus;
  aiAvailable: boolean;
  summary: string | null;
  trends: string | null;
  hotspots: string | null;
  suggestions: string | null;
  generatedAt: string | null;
  createdAt: string;
}

export interface AppSettingsRow {
  id: 1;
  autoCloseTimeoutHours: number;
  updatedBy: number | null;
  updatedAt: string;
}

export interface Database {
  users: UserRow[];
  zones: ZoneRow[];
  categories: CategoryRow[];
  clusters: ClusterRow[];
  complaints: ComplaintRow[];
  evidence: EvidenceRow[];
  statusHistory: StatusHistoryRow[];
  notes: NoteRow[];
  upvotes: UpvoteRow[];
  pointsLedger: PointsLedgerRow[];
  badges: BadgeRow[];
  citizenBadges: CitizenBadgeRow[];
  aiZoneReports: AiZoneReportRow[];
  appSettings: AppSettingsRow;
  /** Auto-increment counters, one per table name. */
  nextId: Record<string, number>;
}
