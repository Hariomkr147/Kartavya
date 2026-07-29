import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as authService from "@/services/auth";
import * as accountService from "@/services/account";
import { ApiRequestError, getStoredToken, setStoredToken } from "@/services/http";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/components/ui/Toast";
import type { LoginRequest, RegisterRequest, User } from "@/types/api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (body: LoginRequest) => Promise<User>;
  register: (body: RegisterRequest) => Promise<User>;
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

  async function login(body: LoginRequest) {
    const response = await authService.login(body);
    setStoredToken(response.token);
    setUser(response.user);
    setStatus("authenticated");
    return response.user;
  }

  async function register(body: RegisterRequest) {
    const response = await authService.register(body);
    setStoredToken(response.token);
    setUser(response.user);
    setStatus("authenticated");
    return response.user;
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
    <AuthContext.Provider value={{ user, status, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
