// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { atlasHref, atlasUrl } from "./routes";

describe("atlasUrl", () => {
  it("builds an absolute link off window.location.origin in a browser context", () => {
    expect(atlasUrl("abc-123")).toBe(`${window.location.origin}${atlasHref("abc-123")}`);
    expect(atlasUrl("abc-123")).toMatch(/^https?:\/\/.+\/atlas\?id=abc-123$/);
  });
});
