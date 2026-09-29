import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as authService from "@/services/auth";
import * as accountService from "@/services/account";
import { ApiRequestError, getStoredToken, setStoredToken } from "@/services/http";
import { queryClient } from "@/lib/queryClient";
import { MfaRequiredError } from "@/lib/mfaRequiredError";
import { useToast } from "@/components/ui/Toast";
import type {
  AuthResponse,
  GoogleSignInRequest,
  LoginRequest,
  RegisterRequest,
  User,
} from "@/types/api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /** Resolves to the user; rejects with `MfaRequiredError` when a code is needed next. */
  login: (body: LoginRequest) => Promise<User>;
  register: (body: RegisterRequest) => Promise<User>;
  /** Same contract as `login`, for a Google ID token. */
  googleSignIn: (body: GoogleSignInRequest) => Promise<User>;
  /** Second step: exchange an `MfaRequiredError`'s ticket plus a code for a session. */
  verifyMfa: (ticket: string, code: string) => Promise<User>;
  logout: () => void;
  /** Re-fetches /users/me — call after a profile edit so the rest of the app sees the change. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Source of truth for "who am I" is always GET /users/me, never decoding the
 * bearer token client-side — see the Stage 1 openapi.yaml addition this was
 * built for. The token itself is opaque to this app.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const { resetSession } = useToast();

  useEffect(() => {
    let cancelled = false;
    async function rehydrate() {
      const token = getStoredToken();
      if (!token) {
        setStatus("unauthenticated");
        return;
      }
      try {
        const profile = await accountService.getMyProfile();
        if (cancelled) return;
        setUser(profile);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        setStoredToken(null);
        setStatus("unauthenticated");
      }
    }
    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  function startSession(response: AuthResponse) {
    setStoredToken(response.token);
    setUser(response.user);
    setStatus("authenticated");
    return response.user;
  }

  /** A first-step response is a session, or a challenge that must be finished. */
  function settle(result: authService.LoginResult) {
    if (authService.isMfaChallenge(result)) throw new MfaRequiredError(result);
    return startSession(result);
  }

  async function login(body: LoginRequest) {
    return settle(await authService.login(body));
  }

  async function googleSignIn(body: GoogleSignInRequest) {
    return settle(await authService.googleSignIn(body));
  }

  async function verifyMfa(ticket: string, code: string) {
    return startSession(await authService.verifyMfaLogin({ mfaTicket: ticket, code }));
  }

  async function register(body: RegisterRequest) {
    return startSession(await authService.register(body));
  }

  function logout() {
    setStoredToken(null);
    setUser(null);
    setStatus("unauthenticated");
    // Every query key in this app is unscoped by user id, so a stale cache
    // entry from the outgoing account would otherwise render instantly for
    // whoever signs in next on this browser — a real privacy leak given the
    // per-role/per-citizen data this app handles.
    queryClient.clear();
    resetSession();
  }

  async function refreshUser() {
    if (!getStoredToken()) return;
    try {
      const profile = await accountService.getMyProfile();
      setUser(profile);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) logout();
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        login,
        register,
        googleSignIn,
        verifyMfa,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
