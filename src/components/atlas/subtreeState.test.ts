import { describe, expect, it } from "vitest";
import {
  deriveSubtreeVisualState,
  nextSubtreeTransition,
  type SubtreeTransition,
  type SubtreeVisualState,
} from "./subtreeState";

describe("deriveSubtreeVisualState", () => {
  it.each([
    [{ collapsed: true, isExpanded: false }, "hidden"],
    [{ collapsed: true, isExpanded: true }, "hidden"],
    [{ collapsed: false, isExpanded: true }, "expanded"],
    [{ collapsed: false, isExpanded: false }, "collapsed"],
  ] as const)("derives %s as %s", (input, expected) => {
    expect(deriveSubtreeVisualState(input)).toBe(expected);
  });
});

describe("nextSubtreeTransition", () => {
  const cases: {
    state: SubtreeVisualState;
    shiftKey: boolean;
    hasExplicitHidden: boolean;
    expected: SubtreeTransition;
  }[] = [
    // Plain click toggles expand ⇄ collapse.
    { state: "collapsed", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { state: "expanded", shiftKey: false, hasExplicitHidden: false, expected: "collapsed" },
    // Shift-click hides, from either open state.
    { state: "collapsed", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { state: "expanded", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    // Clicking a hidden branch restores its snapshot when one exists, otherwise
    // (depth-gate-only hidden) just expands. Shift is irrelevant once hidden.
    { state: "hidden", shiftKey: false, hasExplicitHidden: true, expected: "restore" },
    { state: "hidden", shiftKey: true, hasExplicitHidden: true, expected: "restore" },
    { state: "hidden", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
  ];

  it.each(cases)("$state shift=$shiftKey explicit=$hasExplicitHidden -> $expected", (item) => {
    expect(nextSubtreeTransition(item)).toBe(item.expected);
  });
});
