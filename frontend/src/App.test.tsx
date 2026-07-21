import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./components/ui/Toast";

describe("App", () => {
  it("renders the Stage 4 component playground", () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Kartavya component playground" }),
    ).toBeInTheDocument();
  });
});
