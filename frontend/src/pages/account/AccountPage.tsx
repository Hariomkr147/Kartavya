import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarClock,
  Eye,
  EyeOff,
  KeyRound,
  MapPin,
  ShieldAlert,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { useChangePassword } from "@/hooks/useChangePassword";
import { useDirtyFormGuard } from "@/hooks/useDirtyFormGuard";
import { useToast } from "@/components/ui/Toast";
// import { TwoStepSection } from "@/pages/account/TwoStepSection";
import { GoogleSection } from "@/pages/account/GoogleSection";
import { ApiRequestError } from "@/services/http";
import { absoluteDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";

const buildProfileSchema = (t: TFunction) =>
  z.object({
    name: z.string().min(1, t("validation.nameRequired")),
    displayName: z.string().optional(),
    email: z
      .string()
      .min(1, t("validation.emailRequired"))
      .email(t("validation.emailInvalid")),
    zoneId: z.string().optional(),
  });
type ProfileFormValues = z.infer<ReturnType<typeof buildProfileSchema>>;

const buildPasswordSchema = (t: TFunction) =>
  z
    .object({
      currentPassword: z.string().min(1, t("validation.currentPasswordRequired")),
      newPassword: z.string().min(8, t("validation.newPasswordMinLength")),
      confirmNewPassword: z.string().min(1, t("validation.confirmNewPassword")),
    })
    .refine((v) => v.newPassword === v.confirmNewPassword, {
      message: t("validation.passwordsMismatch"),
      path: ["confirmNewPassword"],
    });
type PasswordFormValues = z.infer<ReturnType<typeof buildPasswordSchema>>;

export function AccountPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: zones, isLoading: zonesLoading } = useZones();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const { toast } = useToast();
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newPasswordCapsLock, setNewPasswordCapsLock] = useState(false);

  const {
    register: registerProfile,
    control: profileControl,
    handleSubmit: handleProfileSubmit,
    setError: setProfileError,
    formState: { errors: profileErrors, isSubmitting: profileSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(useMemo(() => buildProfileSchema(t), [t])),
    values: user
      ? {
          name: user.name,
          displayName: user.displayName ?? "",
          email: user.email ?? "",
          zoneId: user.zoneId ?? "",
        }
      : undefined,
  });

  const {
    register: registerPassword,
    control: passwordControl,
    handleSubmit: handlePasswordSubmit,
    setError: setPasswordError,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors, isSubmitting: passwordSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(useMemo(() => buildPasswordSchema(t), [t])),
  });

  const newPasswordValue =
    useWatch({ control: passwordControl, name: "newPassword" }) ?? "";

  // One guard covering both forms — react-router only expects a single
  // active navigation blocker per component, so this combines both dirty
  // flags rather than calling the hook twice. The message names whichever
  // form actually has unsaved input; a half-typed password never had
  // anywhere it could autosave to, so it's just as much at risk of being
  // lost as the profile form is.
  //
  // Both flags are computed from the VALUES rather than from react-hook-form's
  // `isDirty`. RHF marks a field dirty the moment its value stops being
  // identical to the default, and "identical" is strict: the password form
  // registers with no defaults at all, so every field goes `undefined -> ""`
  // as soon as it is touched, and the profile form's optional fields go
  // `null -> ""` the same way. Both then read as unsaved work and pop a
  // confirm on the way out of a page where nothing was actually typed.
  const passwordValues = useWatch({ control: passwordControl });
  const passwordHasInput = [
    passwordValues?.currentPassword,
    passwordValues?.newPassword,
    passwordValues?.confirmNewPassword,
  ].some((field) => (field ?? "").length > 0);

  const profileValues = useWatch({ control: profileControl });
  const profileHasEdits =
    user != null &&
    ((profileValues?.name ?? "").trim() !== (user.name ?? "").trim() ||
      (profileValues?.displayName ?? "").trim() !== (user.displayName ?? "").trim() ||
      (profileValues?.email ?? "").trim() !== (user.email ?? "").trim() ||
      (profileValues?.zoneId ?? "") !== (user.zoneId ?? ""));

  const passwordIsDirty = passwordHasInput && !passwordSubmitting;
  useDirtyFormGuard(
    (profileHasEdits && !profileSubmitting) || passwordIsDirty,
    passwordIsDirty ? t("account.unsavedPassword") : undefined,
  );

  if (!user) return null;

  const currentZoneName = zones?.find((z) => z.id === user.zoneId)?.name;

  async function onProfileSubmit(values: ProfileFormValues) {
    try {
      await updateProfile.mutateAsync({
        name: values.name,
        displayName: values.displayName?.trim() ? values.displayName.trim() : null,
        email: values.email,
        ...(user!.role === "CITIZEN" ? { zoneId: values.zoneId } : {}),
      });
      toast({ title: t("account.profileUpdated"), variant: "success" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "EMAIL_TAKEN") {
        setProfileError("email", { message: error.message });
        return;
      }
      toast({
        title: t("account.profileUpdateFailed"),
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function onPasswordSubmit(values: PasswordFormValues) {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      resetPasswordForm();
      toast({ title: t("account.passwordUpdated"), variant: "success" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "WRONG_PASSWORD") {
        setPasswordError("currentPassword", { message: error.message });
        return;
      }
      toast({
        title: t("account.passwordUpdateFailed"),
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">
          {t("account.title")}
        </h1>
        <p className="text-ink-muted mt-1 text-sm">{t("account.subtitle")}</p>
        <div className="text-ink-faint mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {user.createdAt && (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {t("account.memberSince", { when: absoluteDateTime(user.createdAt) })}
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1.5 font-medium",
              user.active ? "text-status-resolved" : "text-status-rejected",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                user.active ? "bg-status-resolved" : "bg-status-rejected",
              )}
              aria-hidden="true"
            />
            {user.active ? t("account.active") : t("account.deactivated")}
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-line bg-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserCog className="text-brand size-5" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-ink">
            {t("account.profile")}
          </h2>
        </div>
        <form
          className="space-y-4"
          onSubmit={handleProfileSubmit(onProfileSubmit)}
          noValidate
        >
          <div>
            <Label htmlFor="name" required>
              {t("fields.fullName")}
            </Label>
            <Input
              id="name"
              autoComplete="name"
              error={profileErrors.name?.message}
              {...registerProfile("name")}
            />
          </div>
          <div>
            <Label htmlFor="displayName">{t("fields.displayName")}</Label>
            <Input
              id="displayName"
              hint={t("account.displayNameHint")}
              error={profileErrors.displayName?.message}
              {...registerProfile("displayName")}
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
              error={profileErrors.email?.message}
              {...registerProfile("email")}
            />
          </div>

          {user.role === "CITIZEN" &&
            (zonesLoading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <div>
                <Label htmlFor="zoneId" required>
                  {t("account.homeZone")}
                </Label>
                <p className="text-ink-muted mb-2 flex items-center gap-1.5 text-sm">
                  <MapPin className="size-4" aria-hidden="true" />
                  {t("account.currentZone", { zone: currentZoneName ?? "—" })}
                </p>
                <Controller
                  control={profileControl}
                  name="zoneId"
                  render={({ field }) => (
                    <Combobox
                      id="zoneId"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={profileErrors.zoneId?.message}
                      options={
                        zones?.map((zone) => ({ value: zone.id, label: zone.name })) ?? []
                      }
                    />
                  )}
                />
              </div>
            ))}

          {user.role === "OFFICER" && (
            <div>
              <Label>{t("account.assignedZone")}</Label>
              <p className="text-ink-muted flex items-center gap-1.5 text-sm">
                <MapPin className="size-4" aria-hidden="true" />
                {currentZoneName ?? "—"}
              </p>
              <p className="text-ink-faint mt-1 text-xs">
                {t("account.assignedZoneHint")}
              </p>
            </div>
          )}

          <Button type="submit" loading={profileSubmitting}>
            {t("common.saveChanges")}
          </Button>
        </form>
      </section>

      {/* <TwoStepSection /> */}
      <GoogleSection />

      {/* A Google-only account has no password to change (`hasPassword: false`). */}
      {user.hasPassword !== false && (
        <section className="rounded-lg border border-line bg-surface p-6">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="text-brand size-5" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-ink">
              {t("account.changePassword")}
            </h2>
          </div>
          <form
            className="space-y-4"
            onSubmit={handlePasswordSubmit(onPasswordSubmit)}
            noValidate
          >
            <div>
              <Label htmlFor="currentPassword" required>
                {t("fields.currentPassword")}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                error={passwordErrors.currentPassword?.message}
                {...registerPassword("currentPassword")}
              />
            </div>
            <div>
              <Label htmlFor="newPassword" required>
                {t("fields.newPassword")}
              </Label>
              <Input
                id="newPassword"
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                hint={
                  !passwordErrors.newPassword ? t("register.passwordHint") : undefined
                }
                error={passwordErrors.newPassword?.message}
                rightIcon={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowNewPassword((v) => !v)}
                    aria-label={
                      showNewPassword
                        ? t("fields.hidePassword")
                        : t("fields.showPassword")
                    }
                    className="text-ink-faint hover:text-ink pointer-events-auto"
                  >
                    {showNewPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                }
                onKeyUp={(e) => setNewPasswordCapsLock(e.getModifierState("CapsLock"))}
                {...registerPassword("newPassword")}
              />
              {newPasswordCapsLock && (
                <p className="text-status-needs_more_evidence mt-1.5 flex items-center gap-1 text-xs">
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                  {t("login.capsLock")}
                </p>
              )}
              <PasswordStrengthMeter password={newPasswordValue} />
            </div>
            <div>
              <Label htmlFor="confirmNewPassword" required>
                {t("fields.confirmNewPassword")}
              </Label>
              <Input
                id="confirmNewPassword"
                type="password"
                autoComplete="new-password"
                error={passwordErrors.confirmNewPassword?.message}
                {...registerPassword("confirmNewPassword")}
              />
            </div>
            <Button type="submit" variant="secondary" loading={passwordSubmitting}>
              {t("account.updatePassword")}
            </Button>
          </form>
        </section>
      )}
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
