import { describe, expect, it } from "vitest";
import { locateClaim } from "./claimHighlight";

describe("locateClaim", () => {
  it("finds the claim as a contiguous run of words", () => {
    const text = "Before. The threshold is 7 signers today. After.";
    expect(locateClaim(text, "The threshold is 7 signers")).toEqual({
      start: text.indexOf("The threshold"),
      end: text.indexOf("The threshold") + "The threshold is 7 signers".length,
    });
  });

  it("keeps the longest run when a removed link splits the claim", () => {
    // cleanClaim drops the link text, so the stored claim skips "the accord".
    const text = "Core GovOps validates the accord then transfers responsibility.";
    const claim = "Core GovOps validates then transfers responsibility.";
    const hit = locateClaim(text, claim);
    expect(hit).not.toBeNull();
    expect(text.slice(hit!.start, hit!.end)).toBe("Core GovOps validates");
  });

  it("ignores a run too short to point at", () => {
    expect(locateClaim("See the note.", "See note")).toBeNull();
  });
});
