import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GoogleButton } from "@/components/ui/GoogleButton";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useLinkGoogle } from "@/hooks/useLinkGoogle";
import { useUnlinkGoogle } from "@/hooks/useUnlinkGoogle";
import { isGoogleConfigured } from "@/lib/googleIdentity";
import { ApiRequestError } from "@/services/http";

/**
 * Link or unlink a Google account. This is the only way an officer or admin
 * starts using Google: they log in with their password first, so a typo in a
 * staff email can never hand an account to a stranger's Gmail.
 *
 * Hidden entirely when no Google client id is configured.
 */
export function GoogleSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const link = useLinkGoogle();
  const unlink = useUnlinkGoogle();

  if (!user || !isGoogleConfigured()) return null;
  const linked = user.googleLinked === true;
  const onlyLogin = user.hasPassword === false;

  async function onCredential(idToken: string) {
    try {
      await link.mutateAsync({ idToken });
      toast({ title: t("google.linkSuccess"), variant: "success" });
    } catch (e) {
      toast({
        title: t("google.linkFailed"),
        description: e instanceof ApiRequestError ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function onUnlink() {
    try {
      await unlink.mutateAsync();
      toast({ title: t("google.unlinkSuccess"), variant: "success" });
    } catch (e) {
      toast({
        title: t("google.unlinkFailed"),
        description: e instanceof ApiRequestError ? e.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <div className="mb-1 flex items-center gap-2">
        <Link2 className="text-brand size-5" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-ink">
          {t("google.cardTitle")}
        </h2>
      </div>
      <p className="text-ink-muted mb-4 text-sm">
        {linked ? t("google.linked") : t("google.notLinked")}
      </p>
      {user.role !== "CITIZEN" && !linked && (
        <p className="text-ink-faint mb-4 text-xs">{t("google.staffHint")}</p>
      )}

      {linked ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onUnlink}
            loading={unlink.isPending}
            disabled={onlyLogin}
          >
            {t("google.unlink")}
          </Button>
          {onlyLogin && <p className="text-ink-faint text-xs">{t("google.onlyLogin")}</p>}
        </div>
      ) : (
        <GoogleButton onCredential={onCredential} disabled={link.isPending} />
      )}
    </section>
  );
}
