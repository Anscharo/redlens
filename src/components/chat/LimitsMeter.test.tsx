// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LimitsMeter, humanizeReset } from "./LimitsMeter";
import type { UsageWindow, CommonsPool } from "./api";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(over: Partial<React.ComponentProps<typeof LimitsMeter>> = {}) {
  const props = { usage: null, commons: null, contextTokens: null, contextWindowTokens: null, ...over };
  return render(<LimitsMeter {...props} />);
}

const usage62 = { tokens: 62, limit: 100, resetsAt: "2026-01-01T00:41:00Z", exceeded: false, windowMinutes: 60 } satisfies UsageWindow;

describe("LimitsMeter displayed-limit selection", () => {
  it("shows context window when it's the only known limit", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    expect(screen.getByText("context window · 14% · 18.2k / 128k")).toBeInTheDocument();
  });

  it("shows time limit when it's the only known limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setup({ usage: usage62 });
    expect(screen.getByText("time limit · 62% · resets in 41 min")).toBeInTheDocument();
  });

  it("shows shared credits when it's the only known limit", () => {
    setup({ commons: { used: 17.4, total: 20, remaining: 2.6 } });
    expect(screen.getByText("shared credits · 87% used · $2.60 left")).toBeInTheDocument();
  });

  // The rule: context is what this chat is spending, so it stays on screen even
  // when an account-wide limit happens to sit at a higher fraction.
  it("shows context even when another limit's fraction is higher", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // context 14%, time 62%, commons 87% — context still wins.
    setup({
      contextTokens: 18200,
      contextWindowTokens: 128000,
      usage: usage62,
      commons: { used: 17.4, total: 20, remaining: 2.6 },
    });
    expect(screen.getByText("context window · 14% · 18.2k / 128k")).toBeInTheDocument();
    expect(screen.queryByText(/^time limit/)).toBeNull();
  });

  it("falls back to the fullest known limit while context is still unknown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setup({ usage: usage62, commons: { used: 17.4, total: 20, remaining: 2.6 } }); // 62% vs 87%
    expect(screen.getByText("shared credits · 87% used · $2.60 left")).toBeInTheDocument();
  });

  it("renders an empty (track-only) pie and no summary line when all three are unknown", () => {
    setup();
    const pie = screen.getByRole("button", { name: "Usage limits" });
    expect(pie.querySelectorAll("circle")).toHaveLength(1);
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("treats a usage window with limit 0 as unknown, not a 0% time limit", () => {
    setup({ usage: { tokens: 5, limit: 0, resetsAt: new Date().toISOString(), exceeded: false, windowMinutes: 60 } });
    const pie = screen.getByRole("button", { name: "Usage limits" });
    expect(pie.querySelectorAll("circle")).toHaveLength(1);
  });
});

// The two account-wide limits take the meter over only once they're about to
// run out first: the time window strictly above 95%, the shared pool at 99.5%
// or more. Below that, this chat's own context is the useful number.
describe("LimitsMeter takeover thresholds", () => {
  const ctx14 = { contextTokens: 18200, contextWindowTokens: 128000 };
  const usageAt = (pct: number) =>
    ({ tokens: pct, limit: 100, resetsAt: "2026-01-01T00:41:00Z", exceeded: false, windowMinutes: 60 }) satisfies UsageWindow;
  const pieStroke = () => screen.getByRole("button", { name: /— limits$/ }).querySelectorAll("circle")[1];

  it("hands the meter to the time limit above 95%", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setup({ ...ctx14, usage: usageAt(96) });
    expect(screen.getByText("time limit · 96% · resets in 41 min")).toBeInTheDocument();
    expect(pieStroke()).toHaveAttribute("stroke", "var(--warn)");
  });

  it("keeps context at exactly 95% — the threshold is strictly above", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setup({ ...ctx14, usage: usageAt(95) });
    expect(screen.getByText("context window · 14% · 18.2k / 128k")).toBeInTheDocument();
    expect(pieStroke()).toHaveAttribute("stroke", "var(--accent)");
  });

  it("hands the meter to shared credits at exactly 99.5%", () => {
    setup({ ...ctx14, commons: { used: 199, total: 200, remaining: 1 } });
    expect(screen.getByText("shared credits · 100% used · $1.00 left")).toBeInTheDocument(); // 99.5 rounds to 100
    expect(pieStroke()).toHaveAttribute("stroke", "var(--lilac)");
  });

  it("keeps context just below the shared-credits threshold", () => {
    setup({ ...ctx14, commons: { used: 19.88, total: 20, remaining: 0.12 } }); // 99.4%
    expect(screen.getByText("context window · 14% · 18.2k / 128k")).toBeInTheDocument();
  });

  it("shows the fuller of the two when both are past their thresholds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // time 99.8% vs commons 99.5% — time runs out first.
    setup({ ...ctx14, usage: usageAt(99.8), commons: { used: 199, total: 200, remaining: 1 } });
    expect(screen.getByText("time limit · 100% · resets in 41 min")).toBeInTheDocument();
    // commons 99.9% vs time 96% — commons runs out first.
    cleanup();
    setup({ ...ctx14, usage: usageAt(96), commons: { used: 1998, total: 2000, remaining: 0.02 } });
    expect(screen.getByText("shared credits · 100% used · $0.02 left")).toBeInTheDocument();
  });
});

describe("LimitsMeter shared-credits drained pool", () => {
  it("treats total <= 0 as 100% full (the hard-gate state), not unknown", () => {
    setup({ commons: { used: 0, total: 0, remaining: 0 } });
    expect(screen.getByText("shared credits · 100% used · $0.00 left")).toBeInTheDocument();
  });

  it("takes the meter over from a healthy context window", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000, commons: { used: 0, total: 0, remaining: 0 } });
    expect(screen.getByText("shared credits · 100% used · $0.00 left")).toBeInTheDocument();
  });
});

// The pie's color says WHICH limit is on screen; the summary text still turns
// red past 90% to say how urgent it is. The two are independent now — a hot
// limit no longer repaints the pie, or every takeover would look identical.
describe("LimitsMeter hot state and per-limit colors", () => {
  it("marks the summary hot at >= 90% without changing the pie's identity color", () => {
    setup({ commons: { used: 18, total: 20, remaining: 2 } }); // exactly 90%
    expect(screen.getByText("shared credits · 90% used · $2.00 left")).toHaveAttribute("data-hot", "true");
    const pie = screen.getByRole("button", { name: /— limits$/ });
    expect(pie.querySelectorAll("circle")[1]).toHaveAttribute("stroke", "var(--lilac)");
  });

  it("leaves the summary cool below 90%", () => {
    setup({ commons: { used: 17, total: 20, remaining: 3 } }); // 85%
    expect(screen.getByText("shared credits · 85% used · $3.00 left")).toHaveAttribute("data-hot", "false");
  });

  it("gives each limit its own pie color", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    const stroke = () => screen.getByRole("button", { name: /— limits$/ }).querySelectorAll("circle")[1];
    expect(stroke()).toHaveAttribute("stroke", "var(--accent)"); // context
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setup({ usage: usage62 });
    expect(stroke()).toHaveAttribute("stroke", "var(--warn)"); // time
    cleanup();
    setup({ commons: { used: 17.4, total: 20, remaining: 2.6 } });
    expect(stroke()).toHaveAttribute("stroke", "var(--lilac)"); // commons
  });
});

describe("LimitsMeter popover", () => {
  const commons: CommonsPool = { used: 18.7, total: 20, remaining: 1.3 };

  // Exact "context window" matches only the popover LABEL: getByText sees an
  // element's direct text nodes, so the label's nested scope span is excluded
  // — and the summary line is one long single text node, so it can't collide.
  it("is closed by default and opens on a pie click, listing all three limits with their scopes", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000, commons });
    expect(screen.queryByText("context window")).toBeNull();
    const pie = screen.getByRole("button", { name: /— limits$/ });
    expect(pie).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pie);
    expect(pie).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("context window")).toBeInTheDocument();
    expect(screen.getByText("14% · 18.2k / 128k")).toBeInTheDocument();
    expect(screen.getByText("time limit")).toBeInTheDocument();
    expect(screen.getByText("shared credits")).toBeInTheDocument();
    expect(screen.getByText("94% used · $1.30 left of $20.00")).toBeInTheDocument();
    // Each limit names its scope — three different denominators.
    expect(screen.getByText("· this chat")).toBeInTheDocument();
    expect(screen.getByText("· all your chats")).toBeInTheDocument();
    expect(screen.getByText("· all users")).toBeInTheDocument();
  });

  it("shows '—' for a limit with no data", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    fireEvent.click(screen.getByRole("button", { name: /— limits$/ }));
    // time and commons are both unknown here.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("closes again on a second click", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    const pie = screen.getByRole("button", { name: /— limits$/ });
    fireEvent.click(pie);
    fireEvent.click(pie);
    expect(pie).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("context window")).toBeNull();
  });

  it("closes on a pointerdown outside the meter", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    fireEvent.click(screen.getByRole("button", { name: /— limits$/ }));
    expect(screen.getByText("context window")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("context window")).toBeNull();
  });

  it("does NOT close on a pointerdown inside the popover", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    fireEvent.click(screen.getByRole("button", { name: /— limits$/ }));
    fireEvent.pointerDown(screen.getByText("context window"));
    expect(screen.getByText("context window")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    setup({ contextTokens: 18200, contextWindowTokens: 128000 });
    fireEvent.click(screen.getByRole("button", { name: /— limits$/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("context window")).toBeNull();
  });
});

describe("humanizeReset", () => {
  afterEach(() => vi.useRealTimers());

  it("renders minutes under an hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(humanizeReset("2026-01-01T00:30:00Z")).toBe("30 min");
  });

  it("renders plural hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(humanizeReset("2026-01-01T02:00:00Z")).toBe("2 hours");
  });

  it("renders singular hour at exactly one hour away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(humanizeReset("2026-01-01T01:00:00Z")).toBe("1 hour");
  });

  it("falls back to 'soon' when the reset time is in the past or unparsable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(humanizeReset("not-a-date")).toBe("soon");
    expect(humanizeReset("2025-12-31T23:00:00Z")).toBe("soon");
  });
});
