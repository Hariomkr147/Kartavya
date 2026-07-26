import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { FullPageSpinner } from "@/components/FullPageSpinner";
import type { Role } from "@/types/api";

/**
 * Gates a role-scoped route subtree: redirects to /login (preserving the
 * attempted location) if unauthenticated, or to /403 if the signed-in user's
 * role isn't one of `roles`. Every citizen/officer/admin area uses this —
 * there's no separately-gated "any authenticated role" area in this app.
 */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageSpinner />;
  if (status === "unauthenticated" || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!roles.includes(user.role)) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
