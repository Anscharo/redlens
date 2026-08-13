// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as AnalyticsModule from "./analytics";

const mockInit = vi.fn();
const mockRegister = vi.fn();
const mockCapture = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    capture: (...args: unknown[]) => mockCapture(...args),
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  },
}));

async function freshModule(): Promise<typeof AnalyticsModule> {
  vi.resetModules();
  return import("./analytics");
}

beforeEach(() => {
  mockInit.mockClear();
  mockRegister.mockClear();
  mockCapture.mockClear();
  mockCaptureException.mockClear();
  vi.unstubAllEnvs();
});

describe("analytics (disabled — no VITE_POSTHOG_KEY)", () => {
  beforeEach(() => {
    // Hermetic: a developer's .env.local commonly sets a real VITE_POSTHOG_KEY,
    // which Vite loads into import.meta.env for every test run regardless of
    // this suite's intent. Force it unset so analyticsEnabled reflects "no key"
    // on every machine, not just ones with a bare checkout.
    vi.stubEnv("VITE_POSTHOG_KEY", undefined);
  });

  it("analyticsEnabled is false and every call is a silent no-op", async () => {
    const a = await freshModule();
    expect(a.analyticsEnabled).toBe(false);
    a.initAnalytics();
    a.register({ x: 1 });
    a.track("event", { y: 2 });
    a.captureException(new Error("boom"));
    a.pageview("/foo");
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe("analytics (enabled — VITE_POSTHOG_KEY set)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "test-key-123");
    sessionStorage.removeItem("rl-forced-reload-from");
    delete (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__;
  });

  it("initAnalytics inits posthog exactly once and registers super properties", async () => {
    const a = await freshModule();
    expect(a.analyticsEnabled).toBe(true);
    a.initAnalytics();
    a.initAnalytics(); // second call must no-op (the `started` guard)
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0]).toBe("test-key-123");
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const props = mockRegister.mock.calls[0][0];
    expect(props.host).toBe(window.location.hostname);
    expect(props.environment).toBe("dev"); // jsdom's default host isn't atlas.redline.support
    expect(props.app_commit).toBe("test"); // vitest.config.ts's __COMMIT_HASH__ stub
    expect(props.atlas_commit).toBeNull(); // window.__ATLAS_SHA__ unset
    expect(props.$geoip_disable).toBe(true);
    // jsdom's Navigation Timing entry list is empty, so this exercises the
    // `?? "unknown"` fallback rather than a real "navigate"/"reload" value.
    expect(props.nav_type).toBe("unknown");
  });

  it("fires shell_uninjected when window.__ATLAS_SHA__ isn't a valid 40-hex sha", async () => {
    const a = await freshModule();
    a.initAnalytics(); // __ATLAS_SHA__ unset in this test env
    expect(mockCapture).toHaveBeenCalledWith(
      "shell_uninjected",
      expect.objectContaining({ raw: "", nav_type: "unknown" }),
    );
  });

  it("does not fire shell_uninjected when window.__ATLAS_SHA__ is a valid sha", async () => {
    (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__ = "a".repeat(40);
    const a = await freshModule();
    a.initAnalytics();
    expect(mockCapture).not.toHaveBeenCalledWith("shell_uninjected", expect.anything());
    delete (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__;
  });

  it("fires forced_reload and clears the key when atlasBase.ts left one behind", async () => {
    sessionStorage.setItem("rl-forced-reload-from", "deadbeef");
    const a = await freshModule();
    a.initAnalytics();
    expect(mockCapture).toHaveBeenCalledWith("forced_reload", { from: "deadbeef", to: null });
    expect(sessionStorage.getItem("rl-forced-reload-from")).toBeNull();
  });

  it("does not fire forced_reload when no key is stashed", async () => {
    const a = await freshModule();
    a.initAnalytics();
    expect(mockCapture).not.toHaveBeenCalledWith("forced_reload", expect.anything());
  });

  it("register/track/captureException/pageview call straight through to posthog", async () => {
    const a = await freshModule();
    a.register({ foo: "bar" });
    expect(mockRegister).toHaveBeenCalledWith({ foo: "bar" });

    a.track("clicked", { x: 1 });
    expect(mockCapture).toHaveBeenCalledWith("clicked", { x: 1 });

    a.track("clicked-no-props");
    expect(mockCapture).toHaveBeenCalledWith("clicked-no-props", undefined);

    const err = new Error("boom");
    a.captureException(err, { mechanism: "test" });
    expect(mockCaptureException).toHaveBeenCalledWith(err, { mechanism: "test" });

    a.pageview("/foo/bar?x=1");
    expect(mockCapture).toHaveBeenCalledWith("$pageview", { $current_url: "/foo/bar?x=1" });
  });

  it("registers 'prod' as the environment on the canonical production host", async () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, hostname: "atlas.redline.support" },
      writable: true,
    });
    const a = await freshModule();
    a.initAnalytics();
    expect(mockRegister.mock.calls[0][0].environment).toBe("prod");
  });

  it("sanitize_properties strips non-allowlisted $-props, normalizes the url, and stamps host + geoip", async () => {
    const a = await freshModule();
    a.initAnalytics();
    const config = mockInit.mock.calls[0][1] as { sanitize_properties: (p: Record<string, unknown>) => Record<string, unknown> };
    const out = config.sanitize_properties({
      $session_id: "s1", // kept (allowlisted)
      $screen_height: 900, // stripped (not allowlisted)
      $current_url: "https://example.com/path?x=1#hash", // normalized to relative
      $web_vitals_LCP: 100, // kept ($web_vitals prefix exemption)
      $exception_list: [{ type: "Error" }], // kept ($exception prefix exemption)
      custom: "value", // kept (not $-prefixed)
    });
    expect(out.$geoip_disable).toBe(true);
    expect(out.host).toBe(window.location.hostname);
    expect(out.$current_url).toBe("/path?x=1");
    expect(out.$session_id).toBe("s1");
    expect(out.$screen_height).toBeUndefined();
    expect(out.$web_vitals_LCP).toBe(100);
    expect(out.$exception_list).toEqual([{ type: "Error" }]);
    expect(out.custom).toBe("value");
  });

  it("sanitize_properties leaves a non-string $current_url untouched", async () => {
    const a = await freshModule();
    a.initAnalytics();
    const config = mockInit.mock.calls[0][1] as { sanitize_properties: (p: Record<string, unknown>) => Record<string, unknown> };
    const out = config.sanitize_properties({ $current_url: undefined });
    expect(out.$current_url).toBeUndefined();
  });
});
