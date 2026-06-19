// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { PreviewRollupBadge } from "./PreviewRollupBadge";

const entry = { count: 3, depth: 2 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PreviewRollupBadge", () => {
  it("renders nothing without an entry", () => {
    const { container } = render(<PreviewRollupBadge expanded={false} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing for a zero count", () => {
    const { container } = render(<PreviewRollupBadge entry={{ count: 0, depth: 1 }} expanded={false} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the count on a collapsed node", () => {
    const { container } = render(<PreviewRollupBadge entry={entry} expanded={false} />);
    expect(container.querySelector("button")?.textContent).toBe("3");
  });

  it("renders nothing if its node is already expanded on mount (no fade)", () => {
    const { container } = render(<PreviewRollupBadge entry={entry} expanded={true} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("fades out (leaving) then unmounts (gone) when the node expands", () => {
    const { container, rerender } = render(<PreviewRollupBadge entry={entry} expanded={false} />);
    expect(container.querySelector("button")).not.toBeNull();

    // collapsed → expanded: enters the leaving phase (still mounted, collapsing)
    act(() => {
      rerender(<PreviewRollupBadge entry={entry} expanded={true} />);
    });
    const leaving = container.querySelector("button");
    expect(leaving).not.toBeNull();
    expect(leaving!.style.opacity).toBe("0");
    expect(leaving!.style.width).toBe("0px");

    // after the fade completes it unmounts
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("calls onReveal and stops propagation to the row on click", () => {
    const onReveal = vi.fn();
    const onRowClick = vi.fn();
    const { container } = render(
      <div onClick={onRowClick}>
        <PreviewRollupBadge entry={entry} expanded={false} onReveal={onReveal} />
      </div>,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
