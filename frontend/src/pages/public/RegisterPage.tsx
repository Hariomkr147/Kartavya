import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { Mail, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { ApiRequestError } from "@/services/http";

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

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

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
                type="password"
                autoComplete="new-password"
                hint={!errors.password ? "At least 8 characters." : undefined}
                error={errors.password?.message}
                {...register("password")}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
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
                <Select
                  id="zoneId"
                  defaultValue=""
                  error={errors.zoneId?.message}
                  {...register("zoneId")}
                >
                  <option value="" disabled>
                    Choose a zone…
                  </option>
                  {zones?.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </Select>
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
