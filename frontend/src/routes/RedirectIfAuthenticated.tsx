import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { FullPageSpinner } from "@/components/FullPageSpinner";
import { roleHomePath } from "./roleHome";

/** Wraps the public landing/login/register routes so a signed-in user is sent straight to their dashboard. */
export function RedirectIfAuthenticated() {
  const { user, status } = useAuth();

  if (status === "loading") return <FullPageSpinner />;
  if (status === "authenticated" && user) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }
  return <Outlet />;
}
