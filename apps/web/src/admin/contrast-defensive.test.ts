// contrastRatio's try/catch guards against wcag-contrast's hex() itself
// throwing on some input that still slips past the #rrggbb regex pre-check —
// isolated in its own file since it mocks the whole "wcag-contrast" module,
// which contrast.test.ts's other cases rely on being real.
import { describe, it, expect, vi } from "vitest";

vi.mock("wcag-contrast", () => ({
  hex: () => {
    throw new Error("boom");
  },
  score: () => "Fail",
}));

import { contrastRatio } from "./contrast";

describe("contrastRatio — defensive against the underlying library throwing", () => {
  it("returns null instead of propagating an exception out of hex()", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeNull();
  });
});
