import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useAuth } from "@/contexts/AuthContext";
import { ApiRequestError } from "@/services/http";
import { roleHomePath } from "@/routes/roleHome";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    try {
      const user = await login(values);
      const from = (location.state as { from?: Location })?.from?.pathname;
      navigate(from ?? roleHomePath(user.role), { replace: true });
    } catch (error) {
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
          <h1 className="font-display text-2xl font-semibold text-ink">Sign in</h1>
          <p className="text-ink-muted mt-1 text-sm">
            Track your complaints, or pick up where you left off.
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
                autoComplete="current-password"
                error={errors.password?.message}
                {...register("password")}
              />
            </div>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Sign in
            </Button>
          </form>

          {import.meta.env.VITE_USE_MOCKS === "true" && (
            <p className="text-ink-faint mt-4 text-center text-xs">
              Demo mode — see the browser console for sample logins.
            </p>
          )}
        </div>

        <p className="text-ink-muted mt-6 text-center text-sm">
          New to Kartavya?{" "}
          <Link to="/register" className="text-brand font-medium hover:underline">
            Create a citizen account
          </Link>
        </p>
      </div>
    </div>
  );
}
