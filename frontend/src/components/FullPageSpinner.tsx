import { Loader2 } from "lucide-react";

export function FullPageSpinner() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-canvas"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="text-brand size-8 animate-spin" aria-hidden="true" />
    </div>
  );
}
