// fencedFlags carries the ``` block construct down a diff, so lines whose own
// text looks like ordinary prose are still classified as code when they sit
// inside a fence. Per-side tracking matters because a diff shows the old and
// new documents interleaved.

import { describe, it, expect } from "vitest";
import { fencedFlags } from "./diffFences";
import type { DiffLine } from "@/lib/history";

describe("fencedFlags", () => {
  it("flags the delimiters and the word-like contents between them", () => {
    const lines: DiffLine[] = [
      ["=", "Prose before the block."],
      ["=", "```"],
      ["=", "the reserve is held here"],
      ["+", "and a new plain line too"],
      ["=", "```"],
      ["=", "Prose after the block."],
    ];
    expect(fencedFlags(lines)).toEqual([false, true, true, true, true, false]);
  });

  it("handles an info string on the opening fence", () => {
    const lines: DiffLine[] = [["=", "```solidity"], ["=", "call it"], ["=", "```"], ["=", "after"]];
    expect(fencedFlags(lines)).toEqual([true, true, true, false]);
  });

  it("tracks each side separately when the delimiter row itself is edited", () => {
    // "```" -> "```solidity" is one removed + one added delimiter. Toggling a
    // shared counter twice would close the block immediately; per-side state
    // opens old and new exactly once each.
    const lines: DiffLine[] = [
      ["-", "```"],
      ["+", "```solidity"],
      ["=", "the body of the block"],
      ["=", "```"],
      ["=", "prose again"],
    ];
    expect(fencedFlags(lines)).toEqual([true, true, true, true, false]);
  });

  it("treats a '~' row's reconstructed sides as a fence when either side is", () => {
    const lines: DiffLine[] = [
      ["~", [["=", "``` "], ["-", "sol"], ["+", "solidity"]]],
      ["=", "inside the block"],
      ["=", "```"],
      ["=", "outside"],
    ];
    expect(fencedFlags(lines)).toEqual([true, true, true, false]);
  });

  it("carries an open fence across a '…' gap rather than resetting", () => {
    // The gap hides unchanged lines, so the state is unknowable there. Staying
    // open over-applies monospace at worst; resetting would drop code back to
    // prose mid-block.
    const lines: DiffLine[] = [["=", "```"], ["…"], ["=", "still code"], ["=", "```"], ["=", "prose"]];
    expect(fencedFlags(lines)).toEqual([true, false, true, true, false]);
  });

  it("returns flags aligned 1:1 with the input, tolerating malformed payloads", () => {
    expect(fencedFlags("nope" as unknown as DiffLine[])).toEqual([]);
    const lines = [["=", "a"], "junk", ["~", "not segments"], ["=", "b"]] as unknown as DiffLine[];
    expect(fencedFlags(lines)).toEqual([false, false, false, false]);
  });
});
