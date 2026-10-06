import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleButton } from "./GoogleButton";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
  document.head
    .querySelectorAll('script[src*="accounts.google.com"]')
    .forEach((s) => s.remove());
});

describe("GoogleButton", () => {
  it("renders nothing and loads nothing without a client id", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    const { container } = render(<GoogleButton onCredential={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });

  it("hands Google's ID token to the caller untouched", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };
    const onCredential = vi.fn();

    render(<GoogleButton onCredential={onCredential} text="signin_with" />);
    expect(screen.getByTestId("google-button")).toBeInTheDocument();

    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    const config = initialize.mock.calls[0][0];
    expect(config.client_id).toBe("abc.apps.googleusercontent.com");
    expect(renderButton.mock.calls[0][1]).toMatchObject({
      text: "signin_with",
      locale: "en",
    });

    config.callback({ credential: "header.payload.signature" });
    expect(onCredential).toHaveBeenCalledExactlyOnceWith("header.payload.signature");
  });

  it("says so, instead of showing a dead space, when Google cannot load", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com");
    render(<GoogleButton onCredential={vi.fn()} />);
    const script = await waitFor(() => {
      const el = document.querySelector<HTMLScriptElement>(
        'script[src*="accounts.google.com"]',
      );
      expect(el).not.toBeNull();
      return el!;
    });
    script.onerror?.(new Event("error"));
    expect(await screen.findByText(/Google sign-in couldn't load/)).toBeInTheDocument();
  });
});
