import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Mail,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { Skeleton } from "@/components/ui/Skeleton";
import { GoogleButton } from "@/components/ui/GoogleButton";
import { useAuth } from "@/contexts/AuthContext";
import { MfaRequiredError } from "@/lib/mfaRequiredError";
import { useZones } from "@/hooks/useZones";
import { isGoogleConfigured } from "@/lib/googleIdentity";
import { roleHomePath } from "@/routes/roleHome";
import { ApiRequestError } from "@/services/http";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import type { TranslationKey } from "@/i18n";

const buildRegisterSchema = (t: TFunction) =>
  z
    .object({
      name: z.string().min(1, t("validation.nameRequired")),
      email: z
        .string()
        .min(1, t("validation.emailRequired"))
        .email(t("validation.emailInvalid")),
      password: z.string().min(8, t("validation.passwordMinLength")),
      confirmPassword: z.string().min(1, t("validation.confirmPassword")),
      zoneId: z.string().min(1, t("validation.zoneRequired")),
    })
    .refine((values) => values.password === values.confirmPassword, {
      message: t("validation.passwordsMismatch"),
      path: ["confirmPassword"],
    });

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterSchema>>;

export function RegisterPage() {
  const { t } = useTranslation();
  const { register: registerCitizen, googleSignIn } = useAuth();
  const navigate = useNavigate();
  const { data: zones, isLoading: zonesLoading } = useZones();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  // A Google ID token waiting for a home zone. It stays valid for about an hour,
  // so the citizen can pick a zone and finish without going back to Google.
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(useMemo(() => buildRegisterSchema(t), [t])),
    defaultValues: { zoneId: "" },
  });

  const passwordValue = useWatch({ control, name: "password" }) ?? "";

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      await registerCitizen({
        name: values.name,
        email: values.email,
        password: values.password,
        zoneId: values.zoneId,
      });
      navigate("/citizen", { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "EMAIL_TAKEN") {
        setError("email", { message: error.message });
        return;
      }
      if (error instanceof ApiRequestError) setFormError(error.message);
      else setFormError(t("errors.generic"));
    }
  }

  async function signInWithGoogle(idToken: string) {
    setFormError(null);
    const zoneId = getValues("zoneId");
    try {
      const user = await googleSignIn({ idToken, zoneId: zoneId || undefined });
      navigate(roleHomePath(user.role), { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "ZONE_REQUIRED") {
        setPendingGoogleToken(idToken);
        setError("zoneId", { message: t("google.chooseZone") });
      } else if (error instanceof MfaRequiredError) {
        // Already has an account with two-step verification: the login page finishes it.
        setPendingGoogleToken(null);
        setFormError(t("google.useLogin"));
      } else if (error instanceof ApiRequestError) {
        setFormError(error.message);
      } else {
        setFormError(t("errors.generic"));
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link
            to="/"
            className="text-ink-muted inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            {t("common.back")}
          </Link>
          <LanguageSwitcher />
        </div>
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <ShieldCheck className="text-brand size-7" aria-hidden="true" />
          <span className="font-brand text-xl font-semibold text-ink">Kartavya</span>
        </Link>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <h1 className="font-display text-2xl font-semibold text-ink">
            {t("register.title")}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">{t("register.subtitle")}</p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            {formError && (
              <p
                role="alert"
                className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
              >
                {formError}
              </p>
            )}
            <div>
              <Label htmlFor="name" required>
                {t("fields.fullName")}
              </Label>
              <Input
                id="name"
                autoComplete="name"
                leftIcon={<User className="size-4" />}
                error={errors.name?.message}
                {...register("name")}
              />
            </div>
            <div>
              <Label htmlFor="email" required>
                {t("fields.email")}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                leftIcon={<Mail className="size-4" />}
                error={errors.email?.message}
                {...register("email")}
              />
            </div>
            <div>
              <Label htmlFor="password" required>
                {t("fields.password")}
              </Label>
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                hint={!errors.password ? t("register.passwordHint") : undefined}
                error={errors.password?.message}
                rightIcon={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword ? t("fields.hidePassword") : t("fields.showPassword")
                    }
                    className="text-ink-faint hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                }
                onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                {...register("password")}
              />
              {capsLockOn && (
                <p className="text-status-needs_more_evidence mt-1.5 flex items-center gap-1 text-xs">
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                  {t("login.capsLock")}
                </p>
              )}
              <PasswordStrengthMeter password={passwordValue} />
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>
                {t("fields.confirmPassword")}
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                {...register("confirmPassword")}
              />
            </div>
            <div>
              <Label htmlFor="zoneId" required>
                {t("fields.yourZone")}
              </Label>
              {zonesLoading ? (
                <Skeleton className="h-11 w-full" />
              ) : (
                <Controller
                  control={control}
                  name="zoneId"
                  render={({ field }) => (
                    <Combobox
                      id="zoneId"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={errors.zoneId?.message}
                      placeholderDisabled
                      options={[
                        { value: "", label: t("fields.chooseZone") },
                        ...(zones?.map((zone) => ({
                          value: zone.id,
                          label: zone.name,
                        })) ?? []),
                      ]}
                    />
                  )}
                />
              )}
            </div>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {t("register.submit")}
            </Button>
          </form>

          {isGoogleConfigured() && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-ink-faint text-xs">{t("google.or")}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {pendingGoogleToken ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    if (!getValues("zoneId")) {
                      setError("zoneId", { message: t("google.chooseZone") });
                      return;
                    }
                    void signInWithGoogle(pendingGoogleToken);
                  }}
                >
                  {t("google.finish")}
                </Button>
              ) : (
                <GoogleButton onCredential={signInWithGoogle} text="signup_with" />
              )}
            </div>
          )}
        </div>

        <p className="text-ink-muted mt-6 text-center text-sm">
          {t("register.haveAccount")}{" "}
          <Link to="/login" className="text-brand font-medium hover:underline">
            {t("login.title")}
          </Link>
        </p>
      </div>
    </div>
  );
}

interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  labelKey: TranslationKey | null;
}

const STRENGTH_LABEL_KEYS: TranslationKey[] = [
  "passwordStrength.veryWeak",
  "passwordStrength.weak",
  "passwordStrength.fair",
  "passwordStrength.good",
  "passwordStrength.strong",
];

function scorePassword(password: string): PasswordStrength {
  if (!password) return { score: 0, labelKey: null };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, labelKey: STRENGTH_LABEL_KEYS[clamped] };
}

const STRENGTH_BAR_CLASSES = [
  "bg-status-rejected",
  "bg-status-rejected",
  "bg-status-needs_more_evidence",
  "bg-brand",
  "bg-status-resolved",
];

/** Tiny local strength meter — duplicated across Account/Register/Login rather than shared, since those pages live in different owned directories. */
function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  if (!password) return null;
  const { score, labelKey } = scorePassword(password);
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? STRENGTH_BAR_CLASSES[score] : "bg-line",
            )}
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="text-ink-faint mt-1 text-xs">{labelKey ? t(labelKey) : ""}</p>
    </div>
  );
}
