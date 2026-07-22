import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./components/ui/Toast";

afterEach(() => {
  localStorage.clear();
});

describe("App", () => {
  it("renders the public landing page by default", async () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "What gets seen, gets fixed.",
        level: 1,
      }),
    ).toBeInTheDocument();
  });
});
