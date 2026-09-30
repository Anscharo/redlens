import { describe, expect, it } from "vitest";
import { isReassigned } from "./identitySwap";

describe("isReassigned", () => {
  it("is true only when the displaced content was found under a new UUID", () => {
    expect(isReassigned({ oldTitle: "A", newTitle: "B", movedTo: { id: "x", doc_no: "A.1", title: "A" } })).toBe(true);
    expect(isReassigned({ oldTitle: "A", newTitle: "B" })).toBe(false);
    expect(isReassigned(undefined)).toBe(false);
  });
});
