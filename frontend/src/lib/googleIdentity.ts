/**
 * Loader for Google Identity Services ("Sign in with Google").
 *
 * Nothing loads unless `VITE_GOOGLE_CLIENT_ID` is set, so mock mode, tests and
 * any deployment without Google never contact google.com. The client id is
 * public by design (it names the app, it does not authenticate it).
 *
 * The script hands back an ID token (`credential`); the server verifies it. This
 * file never decides who anybody is.
 */

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: { credential: string }) => void;
  ux_mode?: "popup";
}

export interface GoogleButtonOptions {
  type?: "standard";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill";
  width?: number;
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

export function googleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function isGoogleConfigured(): boolean {
  return googleClientId() !== "";
}

let loading: Promise<GoogleAccountsId> | null = null;

/** Loads the GIS script once. Rejects if it cannot load (offline, blocked). */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;

  loading = new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error("Google Identity Services did not initialise."));
    };
    script.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null; // let a later mount try again
    throw error;
  });
  return loading;
}
