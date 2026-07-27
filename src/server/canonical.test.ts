import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { canonicalRedirect } from "./canonical.ts";
import { config } from "./config.ts";

const origAppUrl = config.appUrl;
const origFlag = config.canonicalHostRedirect;

beforeEach(() => {
  config.appUrl = "https://atlas.redline.support";
  config.canonicalHostRedirect = true;
});

afterAll(() => {
  config.appUrl = origAppUrl;
  config.canonicalHostRedirect = origFlag;
});

describe("canonicalRedirect", () => {
  it("301s a GET on a non-canonical host to the canonical origin, keeping path + query", () => {
    const res = canonicalRedirect(new Request("https://redline.support/some/doc?view=history"));
    expect(res?.status).toBe(301);
    expect(res?.headers.get("location")).toBe("https://atlas.redline.support/some/doc?view=history");
  });

  it("301s the OAuth start route from the apex before any state cookie is set", () => {
    const res = canonicalRedirect(new Request("https://redline.support/api/auth/github"));
    expect(res?.status).toBe(301);
    expect(res?.headers.get("location")).toBe("https://atlas.redline.support/api/auth/github");
  });

  it("redirects HEAD like GET", () => {
    const res = canonicalRedirect(new Request("https://redline.support/", { method: "HEAD" }));
    expect(res?.status).toBe(301);
  });

  it("ignores the request protocol — plain http behind the TLS-terminating edge still matches by host", () => {
    expect(canonicalRedirect(new Request("http://atlas.redline.support/x"))).toBeNull();
    const res = canonicalRedirect(new Request("http://redlens-production.up.railway.app/x"));
    expect(res?.headers.get("location")).toBe("https://atlas.redline.support/x");
  });

  it("matches hosts case-insensitively", () => {
    expect(canonicalRedirect(new Request("https://Atlas.Redline.Support/x"))).toBeNull();
  });

  it("leaves the canonical host alone", () => {
    expect(canonicalRedirect(new Request("https://atlas.redline.support/api/auth/github"))).toBeNull();
  });

  it("never redirects non-GET/HEAD methods", () => {
    expect(canonicalRedirect(new Request("https://redline.support/mcp", { method: "POST" }))).toBeNull();
  });

  it("is inert when appUrl is not https (local dev)", () => {
    config.appUrl = "http://localhost:3000";
    expect(canonicalRedirect(new Request("http://127.0.0.1:3000/"))).toBeNull();
  });

  it("is inert when CANONICAL_HOST_REDIRECT=0", () => {
    config.canonicalHostRedirect = false;
    expect(canonicalRedirect(new Request("https://redline.support/"))).toBeNull();
  });
});
