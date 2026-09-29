import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  googleClientId,
  isGoogleConfigured,
  loadGoogleIdentity,
  type GoogleButtonOptions,
} from "@/lib/googleIdentity";

interface GoogleButtonProps {
  /** Called with Google's ID token. The server verifies it — this component decides nothing. */
  onCredential: (idToken: string) => void;
  text?: GoogleButtonOptions["text"];
  disabled?: boolean;
}

/**
 * The official "Sign in with Google" button, drawn by Google into our page.
 * Renders nothing at all when no client id is configured.
 */
export function GoogleButton({
  onCredential,
  text = "continue_with",
  disabled = false,
}: GoogleButtonProps) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!isGoogleConfigured()) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !host.current) return;
        google.initialize({
          client_id: googleClientId(),
          callback: (response) => latest.current(response.credential),
        });
        host.current.replaceChildren();
        google.renderButton(host.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          width: Math.min(host.current.clientWidth || 320, 400),
          // Matches the app's language, so the label is in the reader's script.
          locale: i18n.language,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text, i18n.language]);

  if (!isGoogleConfigured()) return null;
  if (failed) {
    return (
      <p className="text-ink-muted text-center text-xs">{t("google.unavailable")}</p>
    );
  }
  return (
    <div
      ref={host}
      aria-disabled={disabled}
      className={disabled ? "pointer-events-none opacity-50" : undefined}
      data-testid="google-button"
    />
  );
}
