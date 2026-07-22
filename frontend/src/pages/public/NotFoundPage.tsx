import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={<LinkButton to="/">Back to home</LinkButton>}
      />
    </div>
  );
}
