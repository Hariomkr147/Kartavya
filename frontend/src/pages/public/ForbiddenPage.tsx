import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "@/routes/roleHome";

export function ForbiddenPage() {
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="Kartavya keeps citizen, officer, and admin views strictly separate. If you think this is a mistake, contact your administrator."
        action={
          <LinkButton to={user ? roleHomePath(user.role) : "/"}>
            Back to your dashboard
          </LinkButton>
        }
      />
    </div>
  );
}
