// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const openAuth = vi.fn();
vi.mock("./auth", () => ({ useAuth: () => ({ openAuth }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));
// SignInButtons now renders per the configured providers; under vitest the real
// authProviders() returns [] (usersEnabled() is false via the build define), so
// stub it to both providers to exercise the button rendering these tests assert.
vi.mock("../../lib/authProviders", () => ({ authProviders: () => ["github", "google"] }));

import { SignInButtons } from "./SignInButtons";
import { track } from "../../lib/analytics";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignInButtons", () => {
  it("renders the composer variant with github/google full-width buttons", () => {
    render(<SignInButtons variant="composer" source="chat" />);
    expect(screen.getByText(/sign in with github to ask/)).toBeInTheDocument();
    expect(screen.getByText(/sign in with google to ask/)).toBeInTheDocument();
  });

  it("opens github auth from the composer variant's github button", () => {
    render(<SignInButtons variant="composer" source="chat" />);
    screen.getByText(/sign in with github to ask/).closest("button")!.click();
    expect(openAuth).toHaveBeenCalledWith("github");
  });

  it("opens google auth from the composer variant's google button", () => {
    render(<SignInButtons variant="composer" source="chat" />);
    screen.getByText(/sign in with google to ask/).closest("button")!.click();
    expect(openAuth).toHaveBeenCalledWith("google");
  });

  it("renders the menu variant (default) with 'Continue with' phrasing", () => {
    render(<SignInButtons />);
    expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
  });

  it("tracks the click, calls onBeforeSignIn, then opens auth with the right provider", () => {
    const onBeforeSignIn = vi.fn();
    render(<SignInButtons source="radar" onBeforeSignIn={onBeforeSignIn} />);
    screen.getByText("Continue with GitHub").closest("button")!.click();
    expect(track).toHaveBeenCalledWith("chat_signin_click", { product: "radar", provider: "github" });
    expect(onBeforeSignIn).toHaveBeenCalled();
    expect(openAuth).toHaveBeenCalledWith("github");
  });

  it("opens google auth on the google button", () => {
    render(<SignInButtons />);
    screen.getByText("Continue with Google").closest("button")!.click();
    expect(openAuth).toHaveBeenCalledWith("google");
  });

  it("applies the sans-serif menu class only when sansSerif is set", () => {
    const { rerender } = render(<SignInButtons sansSerif />);
    expect(screen.getByText("Continue with GitHub").closest("button")).toHaveClass("rlc-signin-menu");
    rerender(<SignInButtons sansSerif={false} />);
    expect(screen.getByText("Continue with GitHub").closest("button")).not.toHaveClass("rlc-signin-menu");
  });
});
