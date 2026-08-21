import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DensityProvider } from "./contexts/DensityContext";
import { ToastProvider } from "./components/ui/Toast";
import { initI18n } from "./i18n";
import "./index.css";

async function enableMocksIfNeeded() {
  if (import.meta.env.VITE_USE_MOCKS !== "true") return;
  const { worker, logDemoCredentials } = await import("./mocks/browser");
  await worker.start({
    onUnhandledRequest: "bypass",
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
  logDemoCredentials();
}

// i18n resolves (and fetches, for a non-English locale) before the first
// render, so the app never paints a frame of English at someone who has
// already chosen another language.
Promise.all([enableMocksIfNeeded(), initI18n()]).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <DensityProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DensityProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
