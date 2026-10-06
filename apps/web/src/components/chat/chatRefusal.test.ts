import { describe, expect, it } from "vitest";
import { rateLimitFromBody } from "./chatRefusal";

describe("rateLimitFromBody", () => {
  it("maps each 429 discriminator to its lock kind", () => {
    expect(rateLimitFromBody({ error: "rate_limited", message: "m", resetsAt: "t" })).toEqual({ message: "m", resetsAt: "t", kind: "token" });
    expect(rateLimitFromBody({ error: "commons_exhausted" }).kind).toBe("commons");
    expect(rateLimitFromBody({ error: "too_many_concurrent" }).kind).toBe("concurrent");
  });
  it("falls back to resetsAt presence, then commons, with a default message", () => {
    expect(rateLimitFromBody({ resetsAt: "t" }).kind).toBe("token");
    expect(rateLimitFromBody({})).toEqual({ message: "Usage limit reached.", resetsAt: undefined, kind: "commons" });
  });
});
