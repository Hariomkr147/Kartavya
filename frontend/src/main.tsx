import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DensityProvider } from "./contexts/DensityContext";
import { ToastProvider } from "./components/ui/Toast";
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

enableMocksIfNeeded().then(() => {
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
