import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiRequestError } from "@/services/http";
import * as authService from "@/services/auth";
import type { AuthResponse, MfaChallenge, User } from "@/types/api";

vi.mock("@/services/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/auth")>();
  return { ...actual, login: vi.fn(), googleSignIn: vi.fn(), verifyMfaLogin: vi.fn() };
});

const citizen: User = {
  id: "7",
  role: "CITIZEN",
  name: "Asha Verma",
  email: "asha@example.com",
  active: true,
};
const session: AuthResponse = {
  token: "session-token",
  tokenType: "Bearer",
  expiresAt: "2099-01-01T00:00:00Z",
  user: citizen,
};
const challenge: MfaChallenge = {
  mfaRequired: true,
  mfaTicket: "ticket-abc",
  method: "TOTP",
  expiresAt: "2099-01-01T00:00:00Z",
};

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/citizen" element={<p>citizen home</p>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^Email/), "asha@example.com");
  await user.type(screen.getByLabelText(/^Password/), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.mocked(authService.login).mockReset();
  vi.mocked(authService.verifyMfaLogin).mockReset();
});
afterEach(() => localStorage.clear());

describe("LoginPage", () => {
  it("still signs in straight away when the account has no second step", async () => {
    vi.mocked(authService.login).mockResolvedValue(session);
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    expect(await screen.findByText("citizen home")).toBeInTheDocument();
    expect(authService.verifyMfaLogin).not.toHaveBeenCalled();
  });

  it("asks for the code, then finishes the login with it", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    vi.mocked(authService.verifyMfaLogin).mockResolvedValue(session);
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);

    expect(
      await screen.findByRole("heading", { name: "Two-step verification" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();

    const code = screen.getByLabelText(/^6-digit code/);
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");

    const verify = screen.getByRole("button", { name: "Verify" });
    expect(verify).toBeDisabled(); // not until all six digits are in
    await user.type(code, "12 34ab56"); // spaces and letters are dropped
    expect(code).toHaveValue("123456");
    await user.click(verify);

    expect(await screen.findByText("citizen home")).toBeInTheDocument();
    expect(authService.verifyMfaLogin).toHaveBeenCalledWith({
      mfaTicket: "ticket-abc",
      code: "123456",
    });
  });

  it("stores a session only after the whole login, never at the challenge", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    vi.mocked(authService.verifyMfaLogin).mockResolvedValue(session);
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText(/^6-digit code/), "123456");
    expect(localStorage.getItem("kartavya-auth-token")).toBeNull(); // still half-logged-in
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByText("citizen home");
    expect(localStorage.getItem("kartavya-auth-token")).toBe("session-token");
  });

  it("keeps the ticket out of storage — it is a credential", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    await screen.findByRole("heading", { name: "Two-step verification" });

    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "");
    expect(stored.join("|")).not.toContain("ticket-abc");
    expect(localStorage.getItem("kartavya-auth-token")).toBeNull();
  });

  it("shows the server's message for a wrong code and clears the box", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    vi.mocked(authService.verifyMfaLogin).mockRejectedValue(
      new ApiRequestError(401, "INVALID_CODE", "That code is not right."),
    );
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    const code = await screen.findByLabelText(/^6-digit code/);
    await user.type(code, "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right.");
    expect(code).toHaveValue("");
    expect(
      screen.getByRole("heading", { name: "Two-step verification" }),
    ).toBeInTheDocument();
  });

  it("starts over from the password when the ticket has expired", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    vi.mocked(authService.verifyMfaLogin).mockRejectedValue(
      new ApiRequestError(401, "UNAUTHORIZED", "Invalid or expired sign-in session."),
    );
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    await user.type(await screen.findByLabelText(/^6-digit code/), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your sign-in timed out. Enter your password again.",
    );
    expect(await screen.findByLabelText(/^Password/)).toBeInTheDocument();
  });

  it("lets the user back out of the code step", async () => {
    vi.mocked(authService.login).mockResolvedValue(challenge);
    const user = userEvent.setup();
    renderLogin();
    await submitPassword(user);
    await user.click(await screen.findByRole("button", { name: "Back to sign in" }));
    await waitFor(() => expect(screen.getByLabelText(/^Password/)).toBeInTheDocument());
  });

  it("draws no Google button and loads no Google script when no client id is set", async () => {
    renderLogin();
    await screen.findByLabelText(/^Email/);
    expect(screen.queryByTestId("google-button")).not.toBeInTheDocument();
    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });
});
