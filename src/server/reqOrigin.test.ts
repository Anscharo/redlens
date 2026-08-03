import { describe, it, expect } from "bun:test";
import { resolveOrigin } from "./reqOrigin.ts";

const reqWith = (headers: Record<string, string> = {}) => new Request("http://internal.local/", { headers });

describe("resolveOrigin", () => {
  it("uses appUrl when it is https and its host matches the request host", () => {
    const url = new URL("http://atlas.redline.support/atlas?id=x");
    const req = reqWith({ "x-forwarded-proto": "https" });
    expect(resolveOrigin(req, url, "https://atlas.redline.support")).toBe("https://atlas.redline.support");
  });

  it("does NOT use appUrl for a different host — a preview env inherits prod's pinned APP_URL", () => {
    // The preview must advertise its own reachable host, not production's URL.
    const url = new URL("http://redlens-redlens-pr-230.up.railway.app/atlas");
    const req = reqWith({ "x-forwarded-proto": "https" });
    expect(resolveOrigin(req, url, "https://atlas.redline.support")).toBe(
      "https://redlens-redlens-pr-230.up.railway.app",
    );
  });

  it("honors x-forwarded-proto over the raw (TLS-terminated) request scheme", () => {
    const url = new URL("http://atlas.redline.support/x");
    const req = reqWith({ "x-forwarded-proto": "https" });
    expect(resolveOrigin(req, url, "http://localhost:3000")).toBe("https://atlas.redline.support");
  });

  it("falls back to the request scheme/host when no forwarded headers are present", () => {
    const url = new URL("http://localhost:5173/atlas");
    const req = reqWith();
    expect(resolveOrigin(req, url, "http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("takes the first proto/host in a comma-separated proxy chain", () => {
    const url = new URL("http://internal/x");
    const req = reqWith({ "x-forwarded-proto": "https, http", "x-forwarded-host": "atlas.redline.support, internal" });
    expect(resolveOrigin(req, url, "")).toBe("https://atlas.redline.support");
  });

  it("ignores a non-https appUrl and derives from forwarded headers", () => {
    const url = new URL("http://internal/x");
    const req = reqWith({ "x-forwarded-proto": "https", "x-forwarded-host": "atlas.redline.support" });
    expect(resolveOrigin(req, url, "http://atlas.redline.support")).toBe("https://atlas.redline.support");
  });
});
