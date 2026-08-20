import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <EmptyState
        icon={Compass}
        title={t("notFound.title")}
        description={t("notFound.description")}
        action={<LinkButton to="/">{t("notFound.action")}</LinkButton>}
      />
    </div>
  );
}
