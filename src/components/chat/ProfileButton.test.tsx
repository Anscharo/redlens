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

import { ProfileButton } from "./ProfileButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  user = null;
  prefs = { traces: false, reduceMotion: false };
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

  it("opens the menu showing name, Account, Collections, Sign out", () => {
    user = { name: "Ada Lovelace", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada Lovelace"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
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
