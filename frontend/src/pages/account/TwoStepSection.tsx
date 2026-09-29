import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { Label } from "@/components/ui/Label";
import { QrCode } from "@/components/ui/QrCode";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmMfa } from "@/hooks/useConfirmMfa";
import { useDisableMfa } from "@/hooks/useDisableMfa";
import { useStartMfaSetup } from "@/hooks/useStartMfaSetup";
import { ApiRequestError } from "@/services/http";
import type { MfaSetupResponse } from "@/types/api";

type Step = "idle" | "enrolling" | "disabling";

/**
 * Two-step verification card. Open to every role; officers and admins are only
 * nudged (see MfaRecommendedBanner), never forced.
 *
 * The setup secret lives in this component's state and nowhere else — the server
 * returns it exactly once, and it must not reach a query cache or storage.
 */
export function TwoStepSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const start = useStartMfaSetup();
  const confirm = useConfirmMfa();
  const disable = useDisableMfa();

  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const enabled = user.mfaEnabled === true;

  function reset() {
    setStep("idle");
    setSetup(null);
    setCode("");
    setError(null);
  }

  async function begin() {
    setError(null);
    try {
      setSetup(await start.mutateAsync({ method: "TOTP" }));
      setStep("enrolling");
    } catch (e) {
      toast({
        title: t("mfa.setupFailed"),
        description: e instanceof ApiRequestError ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function submit(action: "confirm" | "disable") {
    setError(null);
    try {
      if (action === "confirm") {
        await confirm.mutateAsync({ code });
        toast({ title: t("mfa.enabledToast"), variant: "success" });
      } else {
        await disable.mutateAsync({ code });
        toast({ title: t("mfa.disabledToast"), variant: "success" });
      }
      reset();
    } catch (e) {
      setCode("");
      setError(e instanceof ApiRequestError ? e.message : t("errors.generic"));
    }
  }

  const busy = confirm.isPending || disable.isPending;
  const valid = /^\d{6}$/.test(code);

  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="text-brand size-5" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-ink">
          {t("mfa.cardTitle")}
        </h2>
        <span
          className={
            enabled
              ? "bg-status-resolved-subtle text-status-resolved ml-auto rounded-full px-2 py-0.5 text-xs font-medium"
              : "bg-canvas text-ink-muted ml-auto rounded-full px-2 py-0.5 text-xs font-medium"
          }
        >
          {enabled ? t("mfa.on") : t("mfa.off")}
        </span>
      </div>
      <p className="text-ink-muted mb-4 text-sm">
        {enabled ? t("mfa.enabledHint") : t("mfa.offHint")}
      </p>

      {step === "idle" && !enabled && (
        <Button type="button" onClick={begin} loading={start.isPending}>
          {t("mfa.setupStart")}
        </Button>
      )}
      {step === "idle" && enabled && (
        <Button type="button" variant="secondary" onClick={() => setStep("disabling")}>
          {t("mfa.disable")}
        </Button>
      )}

      {step === "enrolling" && setup && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("confirm");
          }}
        >
          <p className="text-sm text-ink">{t("mfa.setupScan")}</p>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <QrCode value={setup.otpauthUri} alt={t("mfa.qrAlt")} />
            <div className="min-w-0">
              <p className="text-ink-muted text-xs">{t("mfa.setupKey")}</p>
              <p className="mt-1 flex items-center gap-2">
                <code
                  data-testid="mfa-secret"
                  className="bg-canvas rounded px-2 py-1 font-mono text-sm break-all text-ink select-all"
                >
                  {setup.secret}
                </code>
                <button
                  type="button"
                  aria-label={t("mfa.copyKey")}
                  className="text-ink-faint hover:text-ink"
                  onClick={() => void navigator.clipboard?.writeText(setup.secret)}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </button>
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="mfa-setup-code" required>
              {t("mfa.setupCode")}
            </Label>
            <CodeInput
              id="mfa-setup-code"
              value={code}
              onChange={setCode}
              error={error ?? undefined}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!valid}>
              {t("mfa.confirm")}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {step === "disabling" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("disable");
          }}
        >
          <div>
            <Label htmlFor="mfa-disable-code" required>
              {t("mfa.disableHelp")}
            </Label>
            <CodeInput
              id="mfa-disable-code"
              value={code}
              onChange={setCode}
              error={error ?? undefined}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={!valid}>
              {t("mfa.disable")}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
