import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwoStepSection } from "./TwoStepSection";
import { MfaRecommendedBanner } from "@/components/layout/MfaRecommendedBanner";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/components/ui/Toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ApiRequestError, setStoredToken } from "@/services/http";
import * as account from "@/services/account";
import type { User } from "@/types/api";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") },
}));
vi.mock("@/services/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/account")>();
  return {
    ...actual,
    getMyProfile: vi.fn(),
    startMfaSetup: vi.fn(),
    confirmMfaSetup: vi.fn(),
    disableMfa: vi.fn(),
  };
});

const SECRET = "JBSWY3DPEHPK3PXP";
const off: User = {
  id: "1",
  role: "CITIZEN",
  name: "Asha",
  email: "asha@example.com",
  active: true,
  mfaEnabled: false,
  mfaMethod: null,
  mfaRecommended: false,
  hasPassword: true,
  googleLinked: false,
};
const on: User = { ...off, mfaEnabled: true, mfaMethod: "TOTP" };

function renderWith(ui: React.ReactNode, profile: User) {
  setStoredToken("session-token");
  vi.mocked(account.getMyProfile).mockResolvedValue(profile);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** React Query hands mutationFn a second argument (its context); only the body matters here. */
const bodyOf = (fn: unknown) =>
  vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls[0][0];

beforeEach(() => vi.clearAllMocks());
afterEach(() => localStorage.clear());

describe("TwoStepSection", () => {
  it("walks setup: scan, enter the first code, and it turns on", async () => {
    vi.mocked(account.startMfaSetup).mockResolvedValue({
      method: "TOTP",
      otpauthUri: `otpauth://totp/Kartavya:asha%40example.com?secret=${SECRET}&issuer=Kartavya`,
      secret: SECRET,
    });
    vi.mocked(account.confirmMfaSetup).mockResolvedValue(on);
    const user = userEvent.setup();
    renderWith(<TwoStepSection />, off);

    expect(await screen.findByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up" }));

    expect(bodyOf(account.startMfaSetup)).toEqual({ method: "TOTP" });
    expect(await screen.findByTestId("mfa-secret")).toHaveTextContent(SECRET);
    expect(
      await screen.findByAltText("QR code for your authenticator app"),
    ).toBeInTheDocument();

    const turnOn = screen.getByRole("button", { name: "Turn on" });
    expect(turnOn).toBeDisabled();
    vi.mocked(account.getMyProfile).mockResolvedValue(on); // what the refresh will read
    await user.type(screen.getByLabelText(/^Then enter the 6-digit code/), "123456");
    await user.click(turnOn);

    expect(bodyOf(account.confirmMfaSetup)).toEqual({ code: "123456" });
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-secret")).not.toBeInTheDocument(); // secret is gone
  });

  it("never lets the secret reach storage", async () => {
    vi.mocked(account.startMfaSetup).mockResolvedValue({
      method: "TOTP",
      otpauthUri: "otpauth://totp/x",
      secret: SECRET,
    });
    const user = userEvent.setup();
    renderWith(<TwoStepSection />, off);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    await screen.findByTestId("mfa-secret");

    const stored = [localStorage, sessionStorage]
      .flatMap((s) => Object.keys(s).map((k) => s.getItem(k) ?? ""))
      .join("|");
    expect(stored).not.toContain(SECRET);
  });

  it("shows a wrong first code under the box and clears it, staying on setup", async () => {
    vi.mocked(account.startMfaSetup).mockResolvedValue({
      method: "TOTP",
      otpauthUri: "otpauth://totp/x",
      secret: SECRET,
    });
    vi.mocked(account.confirmMfaSetup).mockRejectedValue(
      new ApiRequestError(400, "INVALID_CODE", "That code is not right."),
    );
    const user = userEvent.setup();
    renderWith(<TwoStepSection />, off);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    const box = await screen.findByLabelText(/^Then enter the 6-digit code/);
    await user.type(box, "000000");
    await user.click(screen.getByRole("button", { name: "Turn on" }));

    expect(await screen.findByText("That code is not right.")).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(screen.getByTestId("mfa-secret")).toBeInTheDocument();
  });

  it("needs a current code to turn it off", async () => {
    vi.mocked(account.disableMfa).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWith(<TwoStepSection />, on);

    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    const submit = screen.getAllByRole("button", { name: "Turn off" })[0];
    expect(submit).toBeDisabled();
    vi.mocked(account.getMyProfile).mockResolvedValue(off);
    await user.type(
      screen.getByLabelText(/^Enter a current code to turn it off/),
      "654321",
    );
    await user.click(submit);

    expect(bodyOf(account.disableMfa)).toEqual({ code: "654321" });
    expect(await screen.findByText("Off")).toBeInTheDocument();
  });

  it("reports a setup that could not start without leaving the card", async () => {
    vi.mocked(account.startMfaSetup).mockRejectedValue(
      new ApiRequestError(
        503,
        "MFA_NOT_CONFIGURED",
        "Two-step verification is not set up.",
      ),
    );
    const user = userEvent.setup();
    renderWith(<TwoStepSection />, off);
    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText("Couldn't start setup")).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-secret")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up" })).toBeInTheDocument();
  });
});

describe("MfaRecommendedBanner", () => {
  it("nudges staff who have not turned it on, and can be dismissed", async () => {
    const user = userEvent.setup();
    renderWith(<MfaRecommendedBanner accountPath="/admin/account" />, {
      ...off,
      role: "ADMIN",
      mfaRecommended: true,
    });
    const link = await screen.findByRole("link", { name: "Set it up" });
    expect(link).toHaveAttribute("href", "/admin/account");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Two-step verification is recommended for your role.",
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("stays out of the way of everyone else", async () => {
    renderWith(<MfaRecommendedBanner accountPath="/citizen/account" />, off);
    await waitFor(() => expect(account.getMyProfile).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
