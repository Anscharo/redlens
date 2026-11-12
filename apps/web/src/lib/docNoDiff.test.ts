import { describe, expect, it } from "vitest";

import { docNoDiff } from "./docNoDiff";

const changed = (prev: string, next: string) => {
  const d = docNoDiff(prev, next);
  const pick = (side: typeof d.prev) => side.filter((s) => s.changed).map((s) => s.text);
  return [pick(d.prev), pick(d.next)];
};

describe("docNoDiff", () => {
  it("marks only the segments that moved", () => {
    expect(changed("A.2.2.8.1", "A.2.3.8.1")).toEqual([["2"], ["3"]]);
    expect(changed("A.1.2", "A.1.3")).toEqual([["2"], ["3"]]);
  });

  it("compares whole segments, not characters", () => {
    expect(changed("A.1.10", "A.1.1")).toEqual([["10"], ["1"]]);
  });

  it("handles a change of depth: the extra segments are the change", () => {
    expect(changed("A.1.2.3", "A.1.3")).toEqual([["2"], []]);
    expect(changed("A.1.5", "A.1.2.5")).toEqual([[], ["2"]]);
    expect(changed("A.1.2.3", "A.4")).toEqual([["1", "2", "3"], ["4"]]);
  });

  it("marks several segments when a renumbering spans them", () => {
    expect(changed("A.1.2.3.4", "A.1.5.6.4")).toEqual([["2", "3"], ["5", "6"]]);
  });

  it("keeps every segment in order on both sides", () => {
    const d = docNoDiff("A.6.1.1.2", "A.6.1.1.3");
    expect(d.prev.map((s) => s.text).join(".")).toBe("A.6.1.1.2");
    expect(d.next.map((s) => s.text).join(".")).toBe("A.6.1.1.3");
  });
});
