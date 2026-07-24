// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let user: { name: string | null; avatarUrl: string } | null = null;
const signOut = vi.fn();
vi.mock("./auth", () => ({ useAuth: () => ({ user, signOut }) }));

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

  it("opens the menu showing name, Preferences, Collections, Sign out", () => {
    user = { name: "Ada Lovelace", avatarUrl: "http://example.com/a.png" };
    render(<ProfileButton />);
    fireEvent.click(screen.getByAltText("Ada Lovelace"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
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
});
