import { describe, expect, it } from "vitest";
import {
  deriveSubtreeVisualState,
  nextSubtreeTransition,
  type SubtreeTransition,
  type SubtreeVisualState,
} from "./subtreeState";

describe("deriveSubtreeVisualState", () => {
  it.each([
    [{ hidden: true, bodiesOpen: false }, "hidden"],
    [{ hidden: true, bodiesOpen: true }, "hidden"],
    [{ hidden: false, bodiesOpen: true }, "open"],
    [{ hidden: false, bodiesOpen: false }, "closed"],
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
    // Plain click toggles open ⇄ closed.
    { state: "closed", shiftKey: false, hasExplicitHidden: false, expected: "open" },
    { state: "open", shiftKey: false, hasExplicitHidden: false, expected: "closed" },
    // Shift-click hides, from either shown state.
    { state: "closed", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    { state: "open", shiftKey: true, hasExplicitHidden: false, expected: "hidden" },
    // Clicking a hidden branch restores its snapshot when one exists, otherwise
    // (depth-gate-only hidden) just opens. Shift is irrelevant once hidden.
    { state: "hidden", shiftKey: false, hasExplicitHidden: true, expected: "restore" },
    { state: "hidden", shiftKey: true, hasExplicitHidden: true, expected: "restore" },
    { state: "hidden", shiftKey: false, hasExplicitHidden: false, expected: "open" },
  ];

  it.each(cases)("$state shift=$shiftKey explicit=$hasExplicitHidden -> $expected", (item) => {
    expect(nextSubtreeTransition(item)).toBe(item.expected);
  });
});
