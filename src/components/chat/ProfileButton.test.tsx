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
  it("shows a sign-in pill and opens a menu with sign-in options on click", () => {
    render(<ProfileButton />);
    const pill = screen.getByText("sign in");
    expect(pill).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(pill);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();
  });

  it("closes the menu on outside click", () => {
    render(
      <div>
        <ProfileButton />
        <div data-testid="outside" />
      </div>,
    );
    fireEvent.click(screen.getByText("sign in"));
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

  it("opens the menu showing name, Preferences, Collections, Sign out", () => {
    user = { name: "Ada Lovelace", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada Lovelace"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
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

  it("navigates into the Preferences sub-panel and back", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Preferences"));
    expect(screen.getByText("Show tool-call traces")).toBeInTheDocument();
    expect(screen.getByText("Reduce motion")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← preferences"));
    expect(screen.queryByText("Show tool-call traces")).toBeNull();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
  });

  it("toggles a preference switch and reflects aria-checked", () => {
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Preferences"));
    const traceSwitch = screen.getByText("Show tool-call traces").closest("button")!;
    expect(traceSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(traceSwitch);
    expect(setPref).toHaveBeenCalledWith("traces", true);
  });

  it("deletes the account from the Preferences panel after confirmation", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Preferences"));
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull(); // menu closes on delete
  });

  it("does not delete when the confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    user = { name: "Ada", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada"));
    fireEvent.click(screen.getByText("Preferences"));
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
