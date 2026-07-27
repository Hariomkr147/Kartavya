import { ThumbsUp } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirmResolution } from "@/hooks/useConfirmResolution";
import { ApiRequestError } from "@/services/http";

/**
 * `POST /complaints/{id}/confirm` needs no body, so confirming a fix doesn't
 * have to cost a page load — this drops the action wherever a resolved
 * complaint is listed. Disputing still routes to the detail page, since that
 * one genuinely needs a reason and a fresh photo.
 */
export function ConfirmFixButton({
  complaintId,
  size = "sm",
  variant = "primary",
  label = "Confirm fix",
}: {
  complaintId: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  label?: string;
}) {
  const { toast } = useToast();
  const confirmResolution = useConfirmResolution(complaintId);

  async function handleConfirm() {
    try {
      await confirmResolution.mutateAsync();
      toast({
        title: "Thanks for confirming!",
        description: `${complaintId} is now closed.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't confirm",
        description:
          error instanceof ApiRequestError
            ? error.message
            : "Something went wrong. Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      loading={confirmResolution.isPending}
      onClick={handleConfirm}
      aria-label={`Confirm the fix for complaint ${complaintId}`}
    >
      <ThumbsUp className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
