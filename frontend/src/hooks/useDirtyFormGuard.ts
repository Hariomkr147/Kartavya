import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page anyway?";

/**
 * Warns before an unsaved form is abandoned — both for in-app navigation
 * (react-router's data-router blocker) and for a tab close/refresh (the
 * browser's native `beforeunload` prompt). Pure client-side guard; nothing
 * is persisted or sent anywhere by this hook itself.
 */
export function useDirtyFormGuard(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, message]);

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
