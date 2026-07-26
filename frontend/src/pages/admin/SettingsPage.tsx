import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useSettings } from "@/hooks/useSettings";
import { useUpdateSettings } from "@/hooks/useUpdateSettings";
import { ApiRequestError } from "@/services/http";

export function AdminSettingsPage() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  // `null` means "untouched" — mirror the server value. Distinguishing this
  // from "" lets the field actually be cleared while typing, instead of
  // snapping back to the last saved value on every keystroke.
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full max-w-sm" />
      </div>
    );
  }

  const current = settings?.autoCloseTimeoutHours ?? 0;
  const displayValue = value ?? String(current);
  const dirty = value !== null && value !== String(current);

  async function handleSave() {
    setError(null);
    const parsed = Number(displayValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError("Must be a whole number ≥ 1.");
      return;
    }
    try {
      await updateSettings.mutateAsync({ autoCloseTimeoutHours: parsed });
      toast({ title: "Settings updated", variant: "success" });
      setValue(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't update.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">Settings</h1>
        <p className="text-ink-muted mt-1 text-sm">System-wide configuration.</p>
      </div>

      <div className="max-w-sm space-y-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center gap-2">
          <SettingsIcon className="text-brand size-5" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-ink">
            Auto-close timeout
          </h2>
        </div>
        <p className="text-ink-muted text-sm">
          How long a Resolved complaint waits for citizen confirmation before auto-closing.
          An auto-close credits no points.
        </p>
        <div>
          <Label htmlFor="auto-close-hours" required>
            Hours
          </Label>
          <Input
            id="auto-close-hours"
            type="number"
            min={1}
            value={displayValue}
            error={error ?? undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button
          disabled={!dirty}
          loading={updateSettings.isPending}
          onClick={handleSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
