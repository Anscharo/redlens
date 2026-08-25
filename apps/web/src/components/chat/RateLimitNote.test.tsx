// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RateLimitNote } from "./RateLimitNote";

afterEach(cleanup);

describe("RateLimitNote", () => {
  it("shows the message and a countdown for the token-window gate, with no recheck button", () => {
    render(
      <RateLimitNote
        rateLimit={{ message: "Usage limit reached.", resetsAt: new Date(Date.now() + 30 * 60_000).toISOString(), kind: "token" }}
        onRecheck={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Usage limit reached.");
    expect(screen.getByText(/You can send again in/)).toBeInTheDocument();
    expect(screen.queryByText("Check now")).toBeNull();
  });

  it("falls back to the pool-topup story for a token gate with no resetsAt", () => {
    render(<RateLimitNote rateLimit={{ message: "Usage limit reached.", kind: "token" }} onRecheck={vi.fn()} />);
    expect(screen.getByText(/waiting for it to be topped up/)).toBeInTheDocument();
  });

  it("shows a manual recheck button for the commons gate and calls onRecheck on click", () => {
    const onRecheck = vi.fn();
    render(<RateLimitNote rateLimit={{ message: "Shared pool is out of credits.", kind: "commons" }} onRecheck={onRecheck} />);
    expect(screen.getByText("Shared pool is out of credits.")).toBeInTheDocument();
    expect(screen.getByText(/waiting for it to be topped up/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Check now"));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("shows a wait-and-retry story for the concurrent gate, with no recheck button or pool copy", () => {
    render(
      <RateLimitNote
        rateLimit={{ message: "You already have 3 chat requests in progress.", kind: "concurrent" }}
        onRecheck={vi.fn()}
      />,
    );
    expect(screen.getByText("You already have 3 chat requests in progress.")).toBeInTheDocument();
    expect(screen.getByText(/Wait for your other in-progress request/)).toBeInTheDocument();
    expect(screen.queryByText("Check now")).toBeNull();
    expect(screen.queryByText(/topped up/)).toBeNull();
  });
});
