import { useState } from "react";
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
import { ApiRequestError } from "@/services/http";
import { absoluteDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const profileSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  displayName: z.string().optional(),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  zoneId: z.string().optional(),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmNewPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.newPassword === v.confirmNewPassword, {
    message: "Passwords don't match",
    path: ["confirmNewPassword"],
  });
type PasswordFormValues = z.infer<typeof passwordSchema>;

export function AccountPage() {
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
    formState: {
      errors: profileErrors,
      isSubmitting: profileSubmitting,
      isDirty: profileDirty,
    },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
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
    formState: {
      errors: passwordErrors,
      isSubmitting: passwordSubmitting,
      isDirty: passwordDirty,
    },
  } = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) });

  // One guard covering both forms — react-router only expects a single
  // active navigation blocker per component, so this combines both dirty
  // flags rather than calling the hook twice. The message names whichever
  // form actually has unsaved input; a half-typed password never had
  // anywhere it could autosave to, so it's just as much at risk of being
  // lost as the profile form is.
  const passwordIsDirty = passwordDirty && !passwordSubmitting;
  useDirtyFormGuard(
    (profileDirty && !profileSubmitting) || passwordIsDirty,
    passwordIsDirty
      ? "Your password change hasn't been saved. Leave this page anyway?"
      : undefined,
  );

  const newPasswordValue =
    useWatch({ control: passwordControl, name: "newPassword" }) ?? "";

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
      toast({ title: "Profile updated", variant: "success" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "EMAIL_TAKEN") {
        setProfileError("email", { message: error.message });
        return;
      }
      toast({
        title: "Couldn't update profile",
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
      toast({ title: "Password updated", variant: "success" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "WRONG_PASSWORD") {
        setPasswordError("currentPassword", { message: error.message });
        return;
      }
      toast({
        title: "Couldn't update password",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">Account</h1>
        <p className="text-ink-muted mt-1 text-sm">Manage your profile and password.</p>
        <div className="text-ink-faint mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {user.createdAt && (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              Member since {absoluteDateTime(user.createdAt)}
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
            {user.active ? "Active" : "Deactivated"}
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-line bg-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserCog className="text-brand size-5" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-ink">Profile</h2>
        </div>
        <form
          className="space-y-4"
          onSubmit={handleProfileSubmit(onProfileSubmit)}
          noValidate
        >
          <div>
            <Label htmlFor="name" required>
              Full name
            </Label>
            <Input
              id="name"
              autoComplete="name"
              error={profileErrors.name?.message}
              {...registerProfile("name")}
            />
          </div>
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              hint="Shown publicly on the feed and leaderboard. Leave blank to use a masked placeholder instead."
              error={profileErrors.displayName?.message}
              {...registerProfile("displayName")}
            />
          </div>
          <div>
            <Label htmlFor="email" required>
              Email
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
                  Home zone
                </Label>
                <p className="text-ink-muted mb-2 flex items-center gap-1.5 text-sm">
                  <MapPin className="size-4" aria-hidden="true" />
                  Current zone: {currentZoneName ?? "—"}
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
              <Label>Assigned zone</Label>
              <p className="text-ink-muted flex items-center gap-1.5 text-sm">
                <MapPin className="size-4" aria-hidden="true" />
                {currentZoneName ?? "—"}
              </p>
              <p className="text-ink-faint mt-1 text-xs">
                Your zone is a work assignment — ask an admin to reassign it.
              </p>
            </div>
          )}

          <Button type="submit" loading={profileSubmitting}>
            Save changes
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="text-brand size-5" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-ink">Change password</h2>
        </div>
        <form
          className="space-y-4"
          onSubmit={handlePasswordSubmit(onPasswordSubmit)}
          noValidate
        >
          <div>
            <Label htmlFor="currentPassword" required>
              Current password
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
              New password
            </Label>
            <Input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              autoComplete="new-password"
              hint={!passwordErrors.newPassword ? "At least 8 characters." : undefined}
              error={passwordErrors.newPassword?.message}
              rightIcon={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
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
                Caps Lock is on
              </p>
            )}
            <PasswordStrengthMeter password={newPasswordValue} />
          </div>
          <div>
            <Label htmlFor="confirmNewPassword" required>
              Confirm new password
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
            Update password
          </Button>
        </form>
      </section>
    </div>
  );
}

interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

function scorePassword(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score: clamped, label: labels[clamped] };
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
  if (!password) return null;
  const { score, label } = scorePassword(password);
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
      <p className="text-ink-faint mt-1 text-xs">{label}</p>
    </div>
  );
}
