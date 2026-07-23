import { forwardRef } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A react-router <Link> styled identically to <Button> — for internal navigation that should look like an action. */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <Link ref={ref} className={buttonClasses(variant, size, className)} {...props} />
  ),
);
LinkButton.displayName = "LinkButton";
