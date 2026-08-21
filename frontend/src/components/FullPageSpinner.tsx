import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

export function FullPageSpinner() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-canvas"
      role="status"
      aria-label={t("common.loading")}
    >
      <Loader2 className="text-brand size-8 animate-spin" aria-hidden="true" />
    </div>
  );
}
