// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let user: { name: string | null; avatarUrl: string } | null = null;
const signOut = vi.fn();
const deleteAccount = vi.fn(() => Promise.resolve(true));
vi.mock("./auth", () => ({ useAuth: () => ({ user, signOut, deleteAccount }) }));

let prefs = { traces: false, reduceMotion: false };
const setPref = vi.fn((k: string, v: boolean) => {
  prefs = { ...prefs, [k]: v };
});
vi.mock("./usePrefs", () => ({ usePrefs: () => ({ prefs, setPref }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
// The signed-out menu renders SignInButtons, which gates on authProviders();
// under vitest the real one returns [] (usersEnabled() is false), so stub it.
vi.mock("../../lib/authProviders", () => ({ authProviders: () => ["github", "google"] }));

let chatEnabledOn = true;
vi.mock("../../lib/chatEnabled", () => ({ chatEnabled: () => chatEnabledOn }));

import { ProfileButton } from "./ProfileButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  user = null;
  prefs = { traces: false, reduceMotion: false };
  chatEnabledOn = true;
});

describe("ProfileButton signed out", () => {
  it("opens a menu offering Sign in and History", () => {
    render(<ProfileButton />);
    const pill = screen.getByRole("button", { name: "Menu" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(pill);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    // Providers live one level down, so the menu itself stays two entries.
    expect(screen.queryByText("Continue with GitHub")).toBeNull();
  });

  it("reveals the providers from the Sign in entry, and comes back", () => {
    render(<ProfileButton />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByText("Sign in"));
    expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← sign in"));
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.queryByText("Continue with GitHub")).toBeNull();
  });

  it("links History at /history and closes the menu on click", () => {
    render(<ProfileButton />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByText("History").closest("a")).toHaveAttribute("href", "/history");
    fireEvent.click(screen.getByText("History"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on outside click", () => {
    render(
      <div>
        <ProfileButton />
        <div data-testid="outside" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("ProfileButton signed in", () => {
  it("shows the avatar and a name fallback when name is null", () => {
    user = { name: null, avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    expect(screen.getByAltText("Signed in")).toBeInTheDocument();
  });

  it("opens the menu showing name, Account, Collections, Sign out", () => {
    user = { name: "Ada Lovelace", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada Lovelace"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("offers History above Collections", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    expect(screen.getByText("History").closest("a")).toHaveAttribute("href", "/history");
    const labels = Array.from(document.querySelectorAll(".rlc-menu-item")).map((el) => el.textContent);
    const historyIdx = labels.findIndex((t) => t?.includes("History"));
    const collectionsIdx = labels.findIndex((t) => t?.includes("Collections"));
    expect(historyIdx).toBeGreaterThanOrEqual(0);
    expect(collectionsIdx).toBe(historyIdx + 1);
  });

  it("shows a Conversations item directly below Collections when chatEnabled() is true", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    chatEnabledOn = true;
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    expect(screen.getByText("Conversations")).toBeInTheDocument();
    // .rlc-menu-item elements aren't given role="menuitem" in the markup, so
    // assert ordering by walking the DOM directly.
    const labels = Array.from(document.querySelectorAll(".rlc-menu-item")).map((el) => el.textContent);
    const collectionsIdx = labels.findIndex((t) => t?.includes("Collections"));
    const conversationsIdx = labels.findIndex((t) => t?.includes("Conversations"));
    expect(collectionsIdx).toBeGreaterThanOrEqual(0);
    expect(conversationsIdx).toBe(collectionsIdx + 1);
  });

  it("hides the Conversations item when chatEnabled() is false", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    chatEnabledOn = false;
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("closes the menu when the Conversations link is clicked", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    chatEnabledOn = true;
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Conversations"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu when the Collections link is clicked", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Collections"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("calls signOut and closes the menu on Sign out click", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Sign out"));
    expect(signOut).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("navigates into the Account sub-panel and back", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    expect(screen.getByText("← account")).toBeInTheDocument();
    expect(screen.getByText("Reduce motion")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← account"));
    expect(screen.queryByText("Reduce motion")).toBeNull();
    expect(screen.queryByText("Delete account")).toBeNull();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("toggles the reduce-motion switch and reflects aria-checked", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    const motionSwitch = screen.getByRole("switch", { name: /reduce motion/i });
    expect(motionSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(motionSwitch);
    expect(setPref).toHaveBeenCalledWith("reduceMotion", true);
  });

  it("shows the switch already on when the stored preference is on", () => {
    prefs = { traces: false, reduceMotion: true };
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    const motionSwitch = screen.getByRole("switch", { name: /reduce motion/i });
    expect(motionSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(motionSwitch);
    expect(setPref).toHaveBeenCalledWith("reduceMotion", false);
  });

  it("does not restore the tool-call traces switch", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    expect(screen.queryByText("Show tool-call traces")).toBeNull();
  });

  it("deletes the account from the Account panel after confirmation", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull(); // menu closes on delete
  });

  it("does not delete when the confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Account"));
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
