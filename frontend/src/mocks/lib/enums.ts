/**
 * Runtime enum guards for the mock's request surface.
 *
 * Handlers parse bodies with `(await request.json()) as SomeRequest` — a
 * TypeScript cast, which erases at runtime and checks nothing. The real
 * backend validates every one of these with a Pydantic enum and answers
 * `400 VALIDATION_ERROR`, so without these guards the mock is strictly more
 * permissive than the server it stands in for, and a client can only find out
 * in production.
 *
 * That gap is not theoretical: an unrecognised `verdict` used to fall through
 * the evidence-review handler's final `else` and drive the complaint to
 * terminal REJECTED — a typo silently killing a citizen's report, with a 200
 * in reply.
 *
 * Keep each list identical to the matching enum in `openapi.yaml`.
 */
import type {
  ComplaintStatus,
  DisputeVerdict,
  EvidenceVerdict,
  SeverityLabel,
  SlaLabel,
  UserRole,
} from "../db/types";
import { Errors, type ApiErrorDetail } from "./http";

export const COMPLAINT_STATUSES = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
] as const satisfies readonly ComplaintStatus[];

export const EVIDENCE_VERDICTS = [
  "VALID",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
] as const satisfies readonly EvidenceVerdict[];

export const DISPUTE_VERDICTS = [
  "UPHELD",
  "REJECTED",
] as const satisfies readonly DisputeVerdict[];

export const SEVERITY_LABELS = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const satisfies readonly SeverityLabel[];

export const SLA_LABELS = [
  "ON_TIME",
  "DELAYED",
  "OVERDUE",
] as const satisfies readonly SlaLabel[];

export const USER_ROLES = [
  "CITIZEN",
  "OFFICER",
  "ADMIN",
] as const satisfies readonly UserRole[];

/** `CreateUserRequest.role` — the API deliberately cannot mint an ADMIN. */
export const CREATABLE_ROLES = ["CITIZEN", "OFFICER"] as const;

export const LEADERBOARD_SCOPES = ["zone", "city"] as const;
export const LEADERBOARD_PERIODS = ["monthly", "all_time"] as const;
export const PERFORMANCE_PERIODS = ["this_month", "last_month", "all_time"] as const;

export function isOneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Validates one enum-valued request field. Returns a 400 response to return
 * straight to the caller, or `null` when the value is acceptable.
 *
 * `optional` mirrors a Pydantic field with a default: absent is fine, but a
 * value that is *present and wrong* is still a 400 rather than being ignored.
 */
export function checkEnum<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
  { optional = false }: { optional?: boolean } = {},
) {
  if (value === undefined || value === null) {
    if (optional) return null;
    return Errors.badRequest(`${field} is required.`, [{ field, issue: "is required" }]);
  }
  if (isOneOf(allowed, value)) return null;
  return Errors.badRequest(`${field} must be one of: ${allowed.join(", ")}.`, [
    { field, issue: `must be one of: ${allowed.join(", ")}` },
  ]);
}

/**
 * Validates an enum-valued query parameter, which may legitimately be absent
 * and may repeat (`?status=A&status=B`, which the contract allows for
 * `status`). An empty string is treated as absent — that is what an unset
 * `<select>` serialises to, and the backend's optional query fields coerce it
 * the same way.
 */
export function checkEnumParam<T extends string>(
  url: URL,
  field: string,
  allowed: readonly T[],
) {
  const values = url.searchParams.getAll(field).filter((v) => v !== "");
  for (const value of values) {
    if (!isOneOf(allowed, value)) {
      return Errors.badRequest(`${field} must be one of: ${allowed.join(", ")}.`, [
        { field, issue: `must be one of: ${allowed.join(", ")}` },
      ]);
    }
  }
  return null;
}

/** Runs several checks, returning the first failure. */
export function firstProblem(...checks: (Response | null)[]) {
  return checks.find((c): c is Response => c !== null) ?? null;
}

export type { ApiErrorDetail };
