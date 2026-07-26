import { apiFetch } from "./http";
import type { AuthResponse, LoginRequest, RegisterRequest } from "@/types/api";

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/login", { method: "POST", body });
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/register", { method: "POST", body });
}
