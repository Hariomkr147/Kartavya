import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsPopover } from "./SettingsPopover";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DensityProvider } from "@/contexts/DensityContext";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function renderPopover() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <DensityProvider>
          <SettingsPopover accountPath="/citizen/account" />
        </DensityProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function open() {
  const user = userEvent.setup();
  renderPopover();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  return user;
}

describe("SettingsPopover", () => {
  it("stays shut until the header button is used", () => {
    renderPopover();
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("opens a settings panel — not a menu, since it holds controls", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows every theme with the current one marked", async () => {
    await open();
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toBeInTheDocument();
    for (const label of ["Light", "Dark", "AMOLED"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies a theme directly instead of cycling to it", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "AMOLED" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("amoled");
    expect(localStorage.getItem("kartavya-theme")).toBe("amoled");
    expect(screen.getByRole("button", { name: "AMOLED" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches table density", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Compact" }));

    expect(localStorage.getItem("kartavya-density")).toBe("compact");
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("links to the role's own account page and closes on the way", async () => {
    const user = await open();
    const link = screen.getByRole("link", { name: /account settings/i });
    expect(link).toHaveAttribute("href", "/citizen/account");

    await user.click(link);
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });
});
