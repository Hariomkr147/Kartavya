import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, MapPin, UserCog } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { useChangePassword } from "@/hooks/useChangePassword";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/services/http";

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

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    setError: setProfileError,
    formState: { errors: profileErrors, isSubmitting: profileSubmitting },
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
    handleSubmit: handlePasswordSubmit,
    setError: setPasswordError,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors, isSubmitting: passwordSubmitting },
  } = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) });

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
        <p className="text-ink-muted mt-1 text-sm">
          Manage your profile and password.
        </p>
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
                <Select
                  id="zoneId"
                  error={profileErrors.zoneId?.message}
                  {...registerProfile("zoneId")}
                >
                  {zones?.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </Select>
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
          <h2 className="font-display text-lg font-semibold text-ink">
            Change password
          </h2>
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
              type="password"
              autoComplete="new-password"
              hint={!passwordErrors.newPassword ? "At least 8 characters." : undefined}
              error={passwordErrors.newPassword?.message}
              {...registerPassword("newPassword")}
            />
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
