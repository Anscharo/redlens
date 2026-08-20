// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { CHEVRON_SETTLE_MS } from "../../lib/chevronSettle";
import { makeNode, makeFlatEntry } from "../../test/fixtures";
import type { RungDir, RungLevel } from "./subtreeState";

afterEach(cleanup);

const baseNode = makeNode({ id: "uuid-test" });
const baseEntry = makeFlatEntry({ node: baseNode });

interface Overrides {
  isSelected?: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
  rungLevel?: RungLevel;
  rungDir?: RungDir;
  gatedCount?: number;
  withExpandAll?: boolean;
  inSelectedOnly?: boolean;
}

function setup(overrides: Overrides = {}) {
  const onNavigate = vi.fn();
  const onToggle = vi.fn();
  const onShiftNavigate = vi.fn();
  const onExpandChildren = vi.fn();
  const pendulum = vi.fn();
  const utils = render(
    <AtlasActionsContext.Provider
      value={{
        navigate: onNavigate,
        toggle: onToggle,
        splitNavigate: onShiftNavigate,
        pendulum: overrides.withExpandAll ? pendulum : undefined,
      }}
    >
      <CollapsibleNode
        entry={baseEntry}
        isSelected={overrides.isSelected ?? false}
        isExpanded={overrides.isExpanded ?? false}
        hasChildren={overrides.hasChildren ?? false}
        rungLevel={overrides.rungLevel ?? 0}
        rungDir={overrides.rungDir ?? 1}
        gatedCount={overrides.gatedCount ?? 0}
        onExpandChildren={onExpandChildren}
        inSelectedOnly={overrides.inSelectedOnly}
      />
    </AtlasActionsContext.Provider>,
  );
  return { ...utils, onNavigate, onToggle, onShiftNavigate, onExpandChildren, pendulum };
}

describe("CollapsibleNode click behaviour", () => {
  it("clicking the title when not selected calls onNavigate once and does not toggle", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 50, clientY: 50 });
    fireEvent.click(heading, { clientX: 50, clientY: 50 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking inside the body when selected + expanded does not navigate or toggle", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: true, isExpanded: true });
    const body = container.querySelector(".atlas-node-body")!;
    fireEvent.mouseDown(body, { clientX: 50, clientY: 50 });
    fireEvent.click(body, { clientX: 50, clientY: 50 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking the title bar when selected with content calls onToggle", () => {
    const { container, onToggle } = setup({ isSelected: true });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 50, clientY: 50 });
    fireEvent.click(heading, { clientX: 50, clientY: 50 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(baseNode.id);
  });

  it("does not navigate when mouse moves past the drag threshold between mousedown and click", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 100, clientY: 100 });
    fireEvent.click(heading, { clientX: 110, clientY: 100 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("navigates when mouseDown and click land at the same position", () => {
    const { container, onNavigate } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 100, clientY: 100 });
    fireEvent.click(heading, { clientX: 100, clientY: 100 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
  });
});

describe("CollapsibleNode depth-6 affordance", () => {
  it("shows no hidden affordance when gatedCount is 0", () => {
    const { container } = setup({ gatedCount: 0 });
    expect(container.querySelector(".view-children-affordance")).toBeNull();
    expect(container.querySelector("[data-has-hidden]")).toBeNull();
  });

  it("renders the 'N hidden' affordance and the data-has-hidden marker", () => {
    const { container, getByText } = setup({ gatedCount: 3 });
    expect(getByText("3 hidden")).toBeTruthy();
    expect(container.querySelector('[data-has-hidden="true"]')).not.toBeNull();
  });

  it("calls onExpandChildren without selecting/toggling the row (stopPropagation)", () => {
    const { getByText, onExpandChildren, onNavigate, onToggle } = setup({ gatedCount: 2 });
    fireEvent.click(getByText("2 hidden"));
    expect(onExpandChildren).toHaveBeenCalledWith(baseNode.id);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("CollapsibleNode pendulum toggle", () => {
  it("hides the pendulum button when the node has no children", () => {
    const { container } = setup({ hasChildren: false, withExpandAll: true });
    expect(container.querySelector(".atlas-node-expand-all")).toBeNull();
  });

  it("shows the pendulum button only when there are children and a pendulum action", () => {
    const { container } = setup({ hasChildren: true, withExpandAll: true });
    expect(container.querySelector(".atlas-node-expand-all")).not.toBeNull();
  });

  it("clicking the » button calls pendulum with the node id, regardless of current rung", () => {
    const { container, pendulum } = setup({ hasChildren: true, withExpandAll: true, rungLevel: 1, rungDir: 1 });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(pendulum).toHaveBeenCalledTimes(1);
    expect(pendulum).toHaveBeenCalledWith(baseNode.id, { reverse: false });
  });

  it("alt-clicking the » button asks for the reversed swing", () => {
    const { container, pendulum } = setup({ hasChildren: true, withExpandAll: true, rungLevel: 1, rungDir: 1 });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!, { altKey: true });
    expect(pendulum).toHaveBeenCalledWith(baseNode.id, { reverse: true });
  });

  it.each([
    [0, "is-hidden"],
    [1, ""],
    [2, "is-open"],
  ] as const)("rung level %d renders class %j", (rungLevel, expectedClass) => {
    const { container } = setup({ hasChildren: true, withExpandAll: true, rungLevel });
    const btn = container.querySelector(".atlas-node-expand-all")!;
    expect(btn.classList.contains("is-open")).toBe(expectedClass === "is-open");
    expect(btn.classList.contains("is-hidden")).toBe(expectedClass === "is-hidden");
  });

  // Hover preview: the button leans 45° toward wherever the next click lands
  // — pure CSS off this custom property (see index.css .atlas-node-toggle:hover).
  it.each([
    [0, 1, -45],
    [1, 1, 45],
    [1, -1, -45],
    [2, 1, 45],
  ] as const)("rung {level: %d, dir: %d} sets --hover-deg to %ddeg", (rungLevel, rungDir, expected) => {
    const { container } = setup({ hasChildren: true, withExpandAll: true, rungLevel, rungDir });
    const btn = container.querySelector(".atlas-node-expand-all") as HTMLElement;
    expect(btn.style.getPropertyValue("--hover-deg")).toBe(`${expected}deg`);
  });

  it("runs the compositor feedback and defers the commit two frames when the button can animate", () => {
    // jsdom has no Element.animate — stub it so the WAAPI feedback path runs
    // instead of the plain synchronous fallback, and make rAF resolve inline so
    // the deferred rAF(rAF(commit)) fires within the test.
    const cancel = vi.fn();
    // `finished` matters: the rotation releases its fill:forwards hold when the
    // spin finishes, not when the rung changes — see doPendulum.
    const animate = vi
      .fn()
      .mockReturnValue({ cancel, finished: Promise.resolve() });
    (HTMLElement.prototype as unknown as { animate: (...a: unknown[]) => unknown }).animate = animate;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const { container, pendulum } = setup({
      hasChildren: true,
      withExpandAll: true,
      rungLevel: 0,
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);

    // The chevron animation (spin + pulse) ran, and the heavy state commit still
    // landed once the two deferred frames resolved.
    expect(animate).toHaveBeenCalled();
    expect(pendulum).toHaveBeenCalledWith(baseNode.id, { reverse: false });

    rafSpy.mockRestore();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  // After a click the chevron holds its new resting angle for a beat even if the
  // pointer never moves away, so the outcome reads before the slow hover drift
  // toward the NEXT rung starts. The CSS hover rule is gated on
  // :not([data-settling]); this is the seam a jsdom test can see.
  it("flags the button [data-settling] on click and lifts it after the settle window", () => {
    vi.useFakeTimers();
    try {
      const { container } = setup({ hasChildren: true, withExpandAll: true, rungLevel: 0 });
      const btn = container.querySelector(".atlas-node-expand-all") as HTMLElement;
      expect(btn.hasAttribute("data-settling")).toBe(false);

      fireEvent.click(btn);
      expect(btn.hasAttribute("data-settling")).toBe(true);

      act(() => vi.advanceTimersByTime(CHEVRON_SETTLE_MS - 1));
      expect(btn.hasAttribute("data-settling")).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(btn.hasAttribute("data-settling")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CollapsibleNode keyboard interaction", () => {
  it("Enter navigates when the row is not selected", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Space toggles when the row is selected and has content", () => {
    const { container, onToggle, onNavigate } = setup({ isSelected: true });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: " " });
    expect(onToggle).toHaveBeenCalledWith(baseNode.id);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const { container, onToggle, onNavigate } = setup({ isSelected: true });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: "Tab" });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // R1: onKeyDown had no target guard, unlike the sibling onClick (which bails
  // via closest('a, button, [role="button"]')) — Enter/Space bubbling up from a
  // nested control got swallowed into toggling/navigating the row instead of
  // running the control's own behavior. These fire keyDown directly on a
  // nested interactive element (as a real keypress on a focused child would
  // bubble) and assert the row does NOT react.
  it("Enter on the pendulum chevron does not navigate/toggle the row", () => {
    const { container, onNavigate, onToggle, pendulum } = setup({
      isSelected: false,
      hasChildren: true,
      withExpandAll: true,
    });
    const btn = container.querySelector(".atlas-node-expand-all")!;
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    // The chevron itself only responds to click (native <button> Enter/Space
    // activation is a browser behavior jsdom's fireEvent.keyDown doesn't
    // simulate) — the point here is only that the ROW didn't hijack the key.
    expect(pendulum).not.toHaveBeenCalled();
  });

  it("Space on the selection checkbox does not toggle/navigate the row", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: true });
    const checkbox = container.querySelector<HTMLInputElement>(".atlas-node-select input")!;
    fireEvent.keyDown(checkbox, { key: " " });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still navigates on Enter when focus is on the row itself, not a nested control", () => {
    // Guards against an overly broad target check swallowing the row's own key.
    const { container, onNavigate } = setup({ isSelected: false });
    const row = container.querySelector(".atlas-node")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
  });
});

describe("CollapsibleNode NR-X doc numbers", () => {
  it("renders an NR-X token via the NR chiclet layout instead of dot-split parts", () => {
    const nrNode = makeNode({ id: "uuid-nr", doc_no: "NR-42" });
    const nrEntry = makeFlatEntry({ node: nrNode });
    const onNavigate = vi.fn();
    const { container } = render(
      <AtlasActionsContext.Provider
        value={{ navigate: onNavigate, toggle: vi.fn(), splitNavigate: vi.fn() }}
      >
        <CollapsibleNode entry={nrEntry} isSelected={false} isExpanded={false} />
      </AtlasActionsContext.Provider>,
    );
    const chiclets = container.querySelectorAll(".atlas-chiclet");
    // "NR-42" → chars ["N","R","-","4","2"], not split on "." (which would be a
    // single one-part token since there's no dot).
    expect(chiclets.length).toBe(5);
    expect(Array.from(chiclets).map((c) => c.textContent).join("")).toBe("NR-42");
  });
});

// In a flat filtered view (selected-only/changed-only), rung 0 is invisible
// (see AtlasReader's filterSet branch) — a chevron that rests at, or leans
// toward, "hidden" there looks like a dead click even though nothing is
// actually hidden. inSelectedOnly swaps in the flat swing (flatNextRung/
// flatReverseRung), which never lands on or previews 0.
describe("CollapsibleNode flat filtered view (inSelectedOnly)", () => {
  it.each([
    // Every one of these leans exactly 45deg toward whichever of open/closed
    // it isn't currently at — {level:1, dir:-1} is the interesting case: the
    // non-flat table above previews -45deg (toward hidden) for it.
    [1, 1, "45deg"],
    [1, -1, "45deg"],
    [2, 1, "45deg"],
  ] as const)("rung {level: %d, dir: %d} sets --hover-deg to %s, never toward hidden", (rungLevel, rungDir, expected) => {
    const { container } = setup({ hasChildren: true, withExpandAll: true, rungLevel, rungDir, inSelectedOnly: true });
    const btn = container.querySelector(".atlas-node-expand-all") as HTMLElement;
    expect(btn.style.getPropertyValue("--hover-deg")).toBe(expected);
  });

  it("swings a plain click between open and closed, never to hidden", () => {
    const { container, pendulum } = setup({ hasChildren: true, withExpandAll: true, rungLevel: 1, rungDir: -1, inSelectedOnly: true });
    // Ordinarily (non-flat) this state's next click would go to rung 0.
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(pendulum).toHaveBeenCalledWith(baseNode.id, { reverse: false });
  });

  it("alt-click lands on the same target a plain click would (no third position to reverse into)", () => {
    const { container, pendulum } = setup({ hasChildren: true, withExpandAll: true, rungLevel: 2, rungDir: 1, inSelectedOnly: true });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!, { altKey: true });
    expect(pendulum).toHaveBeenCalledWith(baseNode.id, { reverse: true });
  });

  it("describes the upcoming click as expand/collapse, never show/hide children", () => {
    const openBtn = setup({ hasChildren: true, withExpandAll: true, rungLevel: 1, rungDir: 1, inSelectedOnly: true }).container.querySelector(
      ".atlas-node-expand-all",
    )!;
    expect(openBtn.getAttribute("title")).toMatch(/^expand child bodies \(alt-click: expand child bodies\)$/);

    const closeBtn = setup({ hasChildren: true, withExpandAll: true, rungLevel: 2, rungDir: 1, inSelectedOnly: true }).container.querySelector(
      ".atlas-node-expand-all",
    )!;
    expect(closeBtn.getAttribute("title")).toMatch(/^collapse child bodies \(alt-click: collapse child bodies\)$/);
  });
});

describe("CollapsibleNode alt hover preview", () => {
  // Both custom properties are always emitted; index.css picks between them on
  // <html data-alt>, so the hover itself stays pure CSS.
  it.each([
    [0, 1, "-45deg", "0deg"],
    [1, 1, "45deg", "-45deg"],
    [1, -1, "-45deg", "45deg"],
    [2, 1, "45deg", "0deg"],
  ] as const)(
    "rung {level: %d, dir: %d} emits --hover-deg %s and --hover-deg-alt %s",
    (rungLevel, rungDir, plain, alt) => {
      const { container } = setup({ hasChildren: true, withExpandAll: true, rungLevel, rungDir });
      const btn = container.querySelector(".atlas-node-expand-all") as HTMLElement;
      expect(btn.style.getPropertyValue("--hover-deg")).toBe(plain);
      expect(btn.style.getPropertyValue("--hover-deg-alt")).toBe(alt);
    },
  );
});
