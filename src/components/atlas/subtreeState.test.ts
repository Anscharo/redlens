import { describe, expect, it } from "vitest";
import {
  deriveSubtreeVisualState,
  nextSubtreeTransition,
  type SubtreeTransition,
  type SubtreeVisualState,
} from "./subtreeState";
import type { SubtreeVisibilityMode } from "./SubtreeVisibilityDemo";

describe("deriveSubtreeVisualState", () => {
  it.each([
    [{ hasExplicitHidden: true, hasGatedHidden: false, isExpanded: false }, "hidden"],
    [{ hasExplicitHidden: false, hasGatedHidden: true, isExpanded: false }, "hidden"],
    [{ hasExplicitHidden: false, hasGatedHidden: false, isExpanded: true }, "expanded"],
    [{ hasExplicitHidden: false, hasGatedHidden: false, isExpanded: false }, "collapsed"],
  ] as const)("derives %s as %s", (input, expected) => {
    expect(deriveSubtreeVisualState(input)).toBe(expected);
  });
});

describe("nextSubtreeTransition", () => {
  const cases: {
    mode: SubtreeVisibilityMode;
    state: SubtreeVisualState;
    shiftKey: boolean;
    hasExplicitHidden: boolean;
    expected: SubtreeTransition;
  }[] = [
    { mode: "cycle", state: "collapsed", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { mode: "cycle", state: "collapsed", shiftKey: true, hasExplicitHidden: false, expected: "expanded" },
    { mode: "cycle", state: "expanded", shiftKey: false, hasExplicitHidden: false, expected: "hidden" },
    { mode: "cycle", state: "expanded", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { mode: "cycle", state: "hidden", shiftKey: false, hasExplicitHidden: false, expected: "collapsed" },
    { mode: "cycle", state: "hidden", shiftKey: true, hasExplicitHidden: true, expected: "collapsed" },
    { mode: "shift-hide-open", state: "collapsed", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { mode: "shift-hide-open", state: "collapsed", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { mode: "shift-hide-open", state: "expanded", shiftKey: false, hasExplicitHidden: false, expected: "collapsed" },
    { mode: "shift-hide-open", state: "expanded", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { mode: "shift-hide-open", state: "hidden", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { mode: "shift-hide-open", state: "hidden", shiftKey: true, hasExplicitHidden: true, expected: "expanded" },
    { mode: "shift-hide-restore", state: "collapsed", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { mode: "shift-hide-restore", state: "collapsed", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { mode: "shift-hide-restore", state: "expanded", shiftKey: false, hasExplicitHidden: false, expected: "collapsed" },
    { mode: "shift-hide-restore", state: "expanded", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { mode: "shift-hide-restore", state: "hidden", shiftKey: false, hasExplicitHidden: false, expected: "expanded" },
    { mode: "shift-hide-restore", state: "hidden", shiftKey: false, hasExplicitHidden: true, expected: "restore" },
    { mode: "shift-hide-restore", state: "hidden", shiftKey: true, hasExplicitHidden: true, expected: "restore" },
  ];

  it.each(cases)("$mode $state shift=$shiftKey explicit=$hasExplicitHidden -> $expected", (item) => {
    expect(nextSubtreeTransition(item)).toBe(item.expected);
  });
});
