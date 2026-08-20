// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  stashAuthReturn,
  takeAuthReturn,
  stashResumeSave,
  takeResumeSave,
  restoreAuthReturn,
} from "./authReturn";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("authReturn — stash/take", () => {
  it("returns the stashed path once, then null (consume-once)", () => {
    stashAuthReturn("/atlas?id=abc");
    expect(takeAuthReturn()).toBe("/atlas?id=abc");
    expect(takeAuthReturn()).toBeNull();
  });

  it("returns null when nothing was stashed", () => {
    expect(takeAuthReturn()).toBeNull();
  });

  it("resume-save flag is one-shot", () => {
    expect(takeResumeSave()).toBe(false);
    stashResumeSave();
    expect(takeResumeSave()).toBe(true);
    expect(takeResumeSave()).toBe(false);
  });
});

describe("restoreAuthReturn", () => {
  it("rewrites the URL to the stashed destination and consumes it", () => {
    window.history.replaceState(null, "", "/");
    stashAuthReturn("/atlas?id=abc&subset=selected");
    restoreAuthReturn();
    expect(window.location.pathname + window.location.search).toBe("/atlas?id=abc&subset=selected");
    // consumed — a second call is a no-op
    window.history.replaceState(null, "", "/home");
    restoreAuthReturn();
    expect(window.location.pathname).toBe("/home");
  });

  it("does nothing when there's no stash", () => {
    window.history.replaceState(null, "", "/atlas");
    restoreAuthReturn();
    expect(window.location.pathname).toBe("/atlas");
  });

  it("no-ops (but still consumes) when the stash equals the current location", () => {
    window.history.replaceState(null, "", "/atlas?id=x");
    stashAuthReturn("/atlas?id=x");
    restoreAuthReturn();
    expect(window.location.pathname + window.location.search).toBe("/atlas?id=x");
    expect(takeAuthReturn()).toBeNull();
  });
});

describe("restoreAuthReturn — preview destinations", () => {
  let originalLocation: Location;
  beforeEach(() => {
    originalLocation = window.location;
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });

  it("does a full navigation (not an in-place rewrite) for a /preview/... destination", () => {
    // PreviewGate never mounts off a bare history.replaceState — a real
    // navigation is required so the freshly-set session cookie is present
    // when the gate re-runs its access check.
    window.history.replaceState(null, "", "/");
    stashAuthReturn("/preview/pull-88");
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      value: { pathname: "/", search: "", replace },
      writable: true,
    });
    restoreAuthReturn();
    expect(replace).toHaveBeenCalledWith("/preview/pull-88");
  });

  it("still uses history.replaceState (no reload) for a normal, non-preview destination", () => {
    window.history.replaceState(null, "", "/");
    stashAuthReturn("/atlas?id=abc");
    restoreAuthReturn();
    expect(window.location.pathname + window.location.search).toBe("/atlas?id=abc");
  });
});
