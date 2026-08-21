import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./base-url";

describe("normalizeBaseUrl", () => {
  it("passes unset and blank input through as undefined", () => {
    expect(normalizeBaseUrl(undefined)).toBeUndefined();
    expect(normalizeBaseUrl("")).toBeUndefined();
    expect(normalizeBaseUrl("   ")).toBeUndefined();
  });

  it("defaults a scheme-less hostname to https", () => {
    expect(normalizeBaseUrl("atlas.redline.support")).toBe("https://atlas.redline.support");
    expect(normalizeBaseUrl("redlens-pr-85d143-128.up.railway.app/")).toBe(
      "https://redlens-pr-85d143-128.up.railway.app",
    );
  });

  it("defaults scheme-less loopback hosts to http", () => {
    expect(normalizeBaseUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeBaseUrl("[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("keeps an explicit scheme and strips trailing slashes and whitespace", () => {
    expect(normalizeBaseUrl(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("https://example.test//")).toBe("https://example.test");
  });

  it("rejects non-http schemes and unparseable input with the raw value in the message", () => {
    expect(() => normalizeBaseUrl("ftp://example.test")).toThrow(/must use http or https/);
    expect(() => normalizeBaseUrl("https://exa mple.test")).toThrow(/"https:\/\/exa mple.test"/);
  });
});
