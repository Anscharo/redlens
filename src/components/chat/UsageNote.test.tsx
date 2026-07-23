// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UsageNote } from "./UsageNote";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UsageNote", () => {
  it("renders nothing when usage is null", () => {
    const { container } = render(<UsageNote usage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when usage has no limit (unlimited / feature off)", () => {
    const { container } = render(
      <UsageNote usage={{ tokens: 10, limit: 0, resetsAt: new Date().toISOString(), exceeded: false, windowMinutes: 60 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows percentage used and is not hot below 80%", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <UsageNote
        usage={{ tokens: 30, limit: 100, resetsAt: "2026-01-01T00:30:00Z", exceeded: false, windowMinutes: 60 }}
      />,
    );
    expect(screen.getByText(/used 30% of your token window/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 30 min/)).toBeInTheDocument();
    const dot = document.querySelector(".rlc-usage-dot");
    expect(dot).toHaveAttribute("data-hot", "false");
  });

  it("marks hot at 80% or more", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <UsageNote
        usage={{ tokens: 85, limit: 100, resetsAt: "2026-01-01T02:00:00Z", exceeded: false, windowMinutes: 60 }}
      />,
    );
    const dot = document.querySelector(".rlc-usage-dot");
    expect(dot).toHaveAttribute("data-hot", "true");
    expect(screen.getByText(/resets in 2 hours/)).toBeInTheDocument();
  });

  it("shows singular 'hour' when reset is exactly one hour away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <UsageNote
        usage={{ tokens: 10, limit: 100, resetsAt: "2026-01-01T01:00:00Z", exceeded: false, windowMinutes: 60 }}
      />,
    );
    expect(screen.getByText(/resets in 1 hour\b/)).toBeInTheDocument();
  });

  it("shows 'soon' when the reset time is in the past or unparsable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    render(
      <UsageNote
        usage={{ tokens: 10, limit: 100, resetsAt: "not-a-date", exceeded: false, windowMinutes: 60 }}
      />,
    );
    expect(screen.getByText(/resets in soon/)).toBeInTheDocument();
  });
});
