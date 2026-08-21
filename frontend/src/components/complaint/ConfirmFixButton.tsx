import { useTranslation } from "react-i18next";
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
  label,
}: {
  complaintId: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  label?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirmResolution = useConfirmResolution(complaintId);

  async function handleConfirm() {
    try {
      await confirmResolution.mutateAsync();
      toast({
        title: t("confirmFix.successTitle"),
        description: t("confirmFix.successBody", { complaintId }),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("confirmFix.errorTitle"),
        description:
          error instanceof ApiRequestError ? error.message : t("errors.generic"),
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
      aria-label={t("confirmFix.ariaLabel", { complaintId })}
    >
      <ThumbsUp className="size-3.5" aria-hidden="true" />
      {label ?? t("confirmFix.label")}
    </Button>
  );
}
