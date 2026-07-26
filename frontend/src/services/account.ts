import { apiFetch } from "./http";
import type { ChangePasswordRequest, UpdateProfileRequest, User } from "@/types/api";

export function getMyProfile(): Promise<User> {
  return apiFetch<User>("/users/me");
}

export function updateMyProfile(body: UpdateProfileRequest): Promise<User> {
  return apiFetch<User>("/users/me", { method: "PATCH", body });
}

export function changeMyPassword(body: ChangePasswordRequest): Promise<void> {
  return apiFetch<void>("/users/me/change-password", { method: "POST", body });
}
