import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "@/routes/roleHome";

export function ForbiddenPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <EmptyState
        icon={ShieldAlert}
        title={t("forbidden.title")}
        description={t("forbidden.description")}
        action={
          <LinkButton to={user ? roleHomePath(user.role) : "/"}>
            {t("forbidden.action")}
          </LinkButton>
        }
      />
    </div>
  );
}
