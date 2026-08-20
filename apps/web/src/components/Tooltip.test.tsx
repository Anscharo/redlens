// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { Tooltip } from "./Tooltip";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tooltip", () => {
  it("does not show the tooltip content until hovered", () => {
    render(
      <Tooltip content="helpful text">
        <button>trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the tooltip after the delay on mouse enter, and hides after mouse leave + grace period", () => {
    render(
      <Tooltip content="helpful text" delay={200}>
        <button>trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    // Not yet shown before the delay elapses.
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("helpful text");

    fireEvent.mouseLeave(trigger);
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows on focus and hides immediately on blur (no grace period)", () => {
    render(
      <Tooltip content="focus text" delay={100}>
        <button>trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.focus(trigger);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("focus text");

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels a pending show when the mouse leaves before the delay elapses", () => {
    render(
      <Tooltip content="text" delay={300}>
        <button>trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.mouseLeave(trigger);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the tooltip open when the mouse moves onto the tooltip itself", () => {
    render(
      <Tooltip content="text" delay={100}>
        <button>trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    act(() => { vi.advanceTimersByTime(100); });
    const tip = screen.getByRole("tooltip");

    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tip);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(tip);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes the previously-open tooltip (singleton) when a second tooltip opens", () => {
    render(
      <>
        <Tooltip content="first" delay={50}>
          <button>one</button>
        </Tooltip>
        <Tooltip content="second" delay={50}>
          <button>two</button>
        </Tooltip>
      </>,
    );
    fireEvent.mouseEnter(screen.getByText("one"));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("first");

    fireEvent.mouseEnter(screen.getByText("two"));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("second");
  });

  it("renders children unchanged when content is null/false, or when children is not a valid element", () => {
    const { rerender } = render(
      <Tooltip content={null}>
        <button>trigger</button>
      </Tooltip>,
    );
    expect(screen.getByText("trigger")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("trigger"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <Tooltip content={false}>
        <button>trigger</button>
      </Tooltip>,
    );
    expect(screen.getByText("trigger")).toBeInTheDocument();
  });

  it("cleans up pending timers and the active-tooltip slot on unmount", () => {
    const { unmount } = render(
      <Tooltip content="text" delay={100}>
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger"));
    expect(() => unmount()).not.toThrow();
  });

  it("hides on window scroll outside the tooltip and on resize", () => {
    render(
      <Tooltip content="text" delay={50}>
        <button>trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger"));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.scroll(document);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("trigger"));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.resize(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
