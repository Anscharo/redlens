// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ContextPie, ContextLine } from "./ContextPie";

afterEach(cleanup);

describe("ContextPie", () => {
  it("renders an empty (track-only) ring and applies the given label when pct is null", () => {
    const onToggle = vi.fn();
    render(<ContextPie pct={null} label="Usage limits" open={false} onToggle={onToggle} />);
    const btn = screen.getByRole("button", { name: "Usage limits" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    // Only the track circle — no filled arc.
    expect(btn.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders a filled arc in the accent color by default", () => {
    render(<ContextPie pct={14} label="context window · 14% · 18.2k / 128k — limits" open={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole("button", {
      name: "context window · 14% · 18.2k / 128k — limits",
    });
    const circles = btn.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    expect(circles[1]).toHaveAttribute("stroke", "var(--accent)");
  });

  // The arc color identifies WHICH limit is shown, so the caller owns it —
  // there is no severity override at any pct, however full the arc gets.
  it("strokes the arc in the caller's color, including when nearly full", () => {
    render(<ContextPie pct={92} label="time limit · 92% — limits" color="var(--warn)" open={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button").querySelectorAll("circle")[1]).toHaveAttribute("stroke", "var(--warn)");
  });

  it("does not draw a filled arc at pct 0 (avoids a stray strokeLinecap dot)", () => {
    render(<ContextPie pct={0} label="context window · 0% · 0 / 128k — limits" open={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.querySelectorAll("circle")).toHaveLength(1);
  });

  it("is clickable even when unknown — it's the only way to reach the limits popover", () => {
    const onToggle = vi.fn();
    render(<ContextPie pct={null} label="Usage limits" open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("reflects the open state via aria-pressed", () => {
    render(<ContextPie pct={14} label="context window · 14% · 18.2k / 128k — limits" open={true} onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ContextLine", () => {
  it("renders nothing when pct is null (unknown)", () => {
    const { container } = render(<ContextLine pct={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a bottom-anchored fill sized to pct, aria-hidden", () => {
    render(<ContextLine pct={14} />);
    const line = document.querySelector(".rlc-ctxline");
    expect(line).toHaveAttribute("aria-hidden", "true");
    // The bar's only self-explanation — a native tooltip, like the pie's, on
    // the track so a hover anywhere along the bar answers.
    expect(line).toHaveAttribute("title", "Context window · 14% used · this chat");
    const fill = document.querySelector(".rlc-ctxline-fill") as HTMLElement;
    expect(fill.style.height).toBe("14%");
    expect(fill).toHaveAttribute("data-hot", "false");
  });

  it("rounds the pct in its tooltip", () => {
    render(<ContextLine pct={14.6} />);
    expect(document.querySelector(".rlc-ctxline")).toHaveAttribute("title", "Context window · 15% used · this chat");
  });

  it("marks data-hot at pct >= 90", () => {
    render(<ContextLine pct={95} />);
    const fill = document.querySelector(".rlc-ctxline-fill");
    expect(fill).toHaveAttribute("data-hot", "true");
  });
});
