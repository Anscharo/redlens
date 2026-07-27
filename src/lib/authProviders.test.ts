// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// authProviders() gates on usersEnabled(); force it on so we exercise the
// provider-parsing branches (the build define is false under vitest).
const h = vi.hoisted(() => ({ usersOn: true }));
vi.mock("./usersEnabled", () => ({ usersEnabled: () => h.usersOn }));

import { authProviders } from "./authProviders";

function setRaw(v: string | undefined) {
  if (v === undefined) delete (window as unknown as { __AUTH_PROVIDERS__?: string }).__AUTH_PROVIDERS__;
  else (window as unknown as { __AUTH_PROVIDERS__?: string }).__AUTH_PROVIDERS__ = v;
}

beforeEach(() => {
  h.usersOn = true;
  setRaw(undefined);
});

describe("authProviders", () => {
  it("returns [] when logins are off, regardless of the injected list", () => {
    h.usersOn = false;
    setRaw("github,google");
    expect(authProviders()).toEqual([]);
  });

  it("parses a single configured provider", () => {
    setRaw("github");
    expect(authProviders()).toEqual(["github"]);
    setRaw("google");
    expect(authProviders()).toEqual(["google"]);
  });

  it("parses both providers, preserving order", () => {
    setRaw("google,github");
    expect(authProviders()).toEqual(["google", "github"]);
  });

  it("treats an intentionally-empty CSV as no providers (no buttons)", () => {
    setRaw("");
    expect(authProviders()).toEqual([]);
  });

  it("falls back to both when the flag is absent (undefined)", () => {
    setRaw(undefined);
    expect(authProviders()).toEqual(["github", "google"]);
  });

  it("falls back to both when the placeholder was never replaced", () => {
    setRaw("{{AUTH_PROVIDERS}}");
    expect(authProviders()).toEqual(["github", "google"]);
  });

  it("ignores unknown/whitespace tokens", () => {
    setRaw("github, facebook , google");
    expect(authProviders()).toEqual(["github", "google"]);
  });
});
