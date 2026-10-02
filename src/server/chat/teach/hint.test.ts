import { describe, expect, it } from "bun:test";
import { looksLikeMiss, TEACH_HINT, withTeachHint } from "./hint.ts";

describe("looksLikeMiss", () => {
  it("fires on honest-miss phrasings", () => {
    expect(looksLikeMiss("I couldn't find a document naming the freeze role.")).toBe(true);
    expect(looksLikeMiss("The atlas does not cover that arrangement.")).toBe(true);
    expect(looksLikeMiss("That address does not exist in the atlas as far as I can tell.")).toBe(true);
    expect(looksLikeMiss("Nothing in the atlas names a Sky Foundation.")).toBe(true);
  });

  it("stays quiet on found answers and short noise", () => {
    expect(looksLikeMiss("Spark is a Prime Agent.")).toBe(false);
    expect(looksLikeMiss("No.")).toBe(false);
    expect(looksLikeMiss("I found the freeze under the Spark artifact.")).toBe(false);
  });
});

describe("withTeachHint", () => {
  it("appends the /teach invitation to a miss that forgot it", () => {
    const out = withTeachHint("I couldn't find a document naming that role.");
    expect(out).toContain(TEACH_HINT);
    expect(out).toContain("/teach");
  });

  it("does not duplicate when the model already mentioned /teach", () => {
    const already = "I couldn't find X. Use /teach to teach me what it is so this mistake is not made again.";
    expect(withTeachHint(already)).toBe(already);
  });

  it("leaves a successful answer untouched", () => {
    const ok = "Spark is a Prime Agent. [Spark](/atlas/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)";
    expect(withTeachHint(ok)).toBe(ok);
  });
});
