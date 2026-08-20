import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { Eye, EyeOff, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useAuth } from "@/contexts/AuthContext";
import { ApiRequestError } from "@/services/http";
import { roleHomePath } from "@/routes/roleHome";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

// The schema is built per render rather than at module scope so its
// validation messages follow the active language.
const buildLoginSchema = (t: TFunction) =>
  z.object({
    email: z
      .string()
      .min(1, t("validation.emailRequired"))
      .email(t("validation.emailInvalid")),
    password: z.string().min(1, t("validation.passwordRequired")),
  });

type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;

const REMEMBERED_EMAIL_KEY = "kartavya-remembered-email";

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(useMemo(() => buildLoginSchema(t), [t])),
    defaultValues: { email: readRememberedEmail() },
  });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    try {
      const user = await login(values);
      try {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, values.email);
      } catch {
        // Best-effort convenience only.
      }
      // Only honor `from` when it's actually inside this user's own role
      // area — RequireRole stashes the attempted path before it even knows
      // who's signing in, so a citizen who followed a stale admin link would
      // otherwise be sent straight from a successful login to /403.
      const from = (location.state as { from?: Location })?.from?.pathname;
      const home = roleHomePath(user.role);
      const destination =
        from && (from === home || from.startsWith(`${home}/`)) ? from : home;
      navigate(destination, { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) setFormError(error.message);
      else setFormError(t("errors.generic"));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <LanguageSwitcher />
        </div>
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <ShieldCheck className="text-brand size-7" aria-hidden="true" />
          <span className="font-display text-xl font-semibold text-ink">Kartavya</span>
        </Link>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <h1 className="font-display text-2xl font-semibold text-ink">
            {t("login.title")}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">{t("login.subtitle")}</p>

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
                autoComplete="current-password"
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
            </div>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {t("login.title")}
            </Button>
          </form>

          {import.meta.env.VITE_USE_MOCKS === "true" && (
            <p className="text-ink-faint mt-4 text-center text-xs">
              {t("login.demoMode")}
            </p>
          )}
        </div>

        <p className="text-ink-muted mt-6 text-center text-sm">
          {t("login.newHere")}{" "}
          <Link to="/register" className="text-brand font-medium hover:underline">
            {t("login.createAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
