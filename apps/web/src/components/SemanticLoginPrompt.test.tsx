// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SearchState } from "../hooks/useSearch";

const users = vi.hoisted(() => ({ enabled: true }));
vi.mock("../lib/usersEnabled", () => ({ usersEnabled: () => users.enabled }));
vi.mock("./chat/SignInButtons", () => ({ SignInButtons: () => <button>Continue with GitHub</button> }));

import { SemanticLoginPrompt, showsLoginPrompt } from "./SemanticLoginPrompt";

afterEach(() => {
  cleanup();
  users.enabled = true;
});

const limited = (semanticLimit?: "shared" | "user"): SearchState => ({
  status: "done",
  hits: [],
  durationMs: 1,
  query: "who approves rewards",
  lane: "semantic",
  semantic: "skipped",
  semanticNote: "the meaning index is busy — try again in a moment",
  ...(semanticLimit ? { semanticLimit } : {}),
});

describe("SemanticLoginPrompt", () => {
  it("shows a centred heading with the sign-in buttons below when the shared budget is spent", () => {
    render(<SemanticLoginPrompt state={limited("shared")} />);
    expect(screen.getByRole("heading", { name: "Log in for more meaning search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
  });

  it("stays away for the reader's own limit, another failure, or a deployment without logins", () => {
    expect(showsLoginPrompt(limited("user"))).toBe(false);
    expect(showsLoginPrompt(limited())).toBe(false);
    users.enabled = false;
    expect(showsLoginPrompt(limited("shared"))).toBe(false);
    const { container } = render(<SemanticLoginPrompt state={limited("shared")} />);
    expect(container).toBeEmptyDOMElement();
  });
});
