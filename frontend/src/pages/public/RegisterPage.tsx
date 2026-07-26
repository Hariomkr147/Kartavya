import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Mail, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { ApiRequestError } from "@/services/http";
import { cn } from "@/lib/utils";

const registerSchema = z
  .object({
    name: z.string().min(1, "Full name is required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
    zoneId: z.string().min(1, "Choose your zone"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { register: registerCitizen } = useAuth();
  const navigate = useNavigate();
  const { data: zones, isLoading: zonesLoading } = useZones();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
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
      else setFormError("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <ShieldCheck className="text-brand size-7" aria-hidden="true" />
          <span className="font-display text-xl font-semibold text-ink">Kartavya</span>
        </Link>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <h1 className="font-display text-2xl font-semibold text-ink">
            Create a citizen account
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Officers and admins are added by an administrator.
          </p>

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
                Full name
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
                Email
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
                Password
              </Label>
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                hint={!errors.password ? "At least 8 characters." : undefined}
                error={errors.password?.message}
                rightIcon={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
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
                  Caps Lock is on
                </p>
              )}
              <PasswordStrengthMeter password={passwordValue} />
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>
                Confirm password
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
                Your zone
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
                        { value: "", label: "Choose a zone…" },
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
              Create account
            </Button>
          </form>
        </div>

        <p className="text-ink-muted mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link to="/login" className="text-brand font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
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
