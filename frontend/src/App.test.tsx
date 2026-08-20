import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./components/ui/Toast";
import { changeLanguage } from "./i18n";

beforeEach(async () => {
  await changeLanguage("en");
  window.history.pushState({}, "", "/");
});

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

  it("preserves routed form state when the language changes", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>,
    );

    await user.click(screen.getAllByRole("link", { name: "Sign in" })[0]);
    const email = await screen.findByLabelText(/^Email/);
    const password = screen.getByLabelText(/^Password/);
    await user.type(email, "citizen@example.com");
    await user.type(password, "secret-password");

    await user.click(screen.getByRole("button", { name: "Language" }));
    await user.click(screen.getByRole("radio", { name: /Hindi/ }));

    expect(email).toHaveValue("citizen@example.com");
    expect(password).toHaveValue("secret-password");
    expect(window.location.pathname).toBe("/login");
  });
});
