import { apiFetch } from "./http";
import type {
  AuthResponse,
  GoogleSignInRequest,
  LoginRequest,
  MfaChallenge,
  MfaVerifyRequest,
  RegisterRequest,
} from "@/types/api";

/** `/auth/login` and `/auth/google` answer 200/201 with a session, or 202 with a challenge. */
export type LoginResult = AuthResponse | MfaChallenge;

export function isMfaChallenge(result: LoginResult): result is MfaChallenge {
  return "mfaRequired" in result && result.mfaRequired === true;
}

export function login(body: LoginRequest): Promise<LoginResult> {
  return apiFetch<LoginResult>("/auth/login", { method: "POST", body });
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/register", { method: "POST", body });
}

export function googleSignIn(body: GoogleSignInRequest): Promise<LoginResult> {
  return apiFetch<LoginResult>("/auth/google", { method: "POST", body });
}

export function verifyMfaLogin(body: MfaVerifyRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/mfa/verify", { method: "POST", body });
}
