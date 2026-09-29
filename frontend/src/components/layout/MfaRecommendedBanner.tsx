import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ShieldAlert, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * A nudge, never a gate: shown to roles the server marks `mfaRecommended`
 * (officers and admins) while two-step verification is still off. Nothing is
 * blocked; dismissing it lasts until the next page load.
 */
export function MfaRecommendedBanner({ accountPath }: { accountPath: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!user?.mfaRecommended || dismissed) return null;

  return (
    <div
      role="status"
      className="bg-status-needs_more_evidence-subtle text-status-needs_more_evidence flex items-center gap-3 px-4 py-2 text-sm"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {t("mfa.bannerText")}{" "}
        <Link to={accountPath} className="font-semibold underline underline-offset-2">
          {t("mfa.bannerAction")}
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("common.dismiss")}
        className="shrink-0 rounded p-1 hover:bg-black/5"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
