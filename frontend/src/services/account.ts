import { apiFetch } from "./http";
import type {
  ChangePasswordRequest,
  LinkGoogleRequest,
  MfaCodeRequest,
  MfaSetupRequest,
  MfaSetupResponse,
  UpdateProfileRequest,
  User,
} from "@/types/api";

export function getMyProfile(): Promise<User> {
  return apiFetch<User>("/users/me");
}

export function updateMyProfile(body: UpdateProfileRequest): Promise<User> {
  return apiFetch<User>("/users/me", { method: "PATCH", body });
}

export function changeMyPassword(body: ChangePasswordRequest): Promise<void> {
  return apiFetch<void>("/users/me/change-password", { method: "POST", body });
}

export function startMfaSetup(body: MfaSetupRequest): Promise<MfaSetupResponse> {
  return apiFetch<MfaSetupResponse>("/users/me/mfa", { method: "POST", body });
}

export function confirmMfaSetup(body: MfaCodeRequest): Promise<User> {
  return apiFetch<User>("/users/me/mfa/confirm", { method: "POST", body });
}

export function disableMfa(body: MfaCodeRequest): Promise<void> {
  return apiFetch<void>("/users/me/mfa/disable", { method: "POST", body });
}

export function linkGoogle(body: LinkGoogleRequest): Promise<User> {
  return apiFetch<User>("/users/me/google", { method: "POST", body });
}

export function unlinkGoogle(): Promise<void> {
  return apiFetch<void>("/users/me/google", { method: "DELETE" });
}
