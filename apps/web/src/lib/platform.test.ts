// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// platform.ts resolves everything at module load, so each case has to stub
// navigator first and then re-import through a reset module registry.
async function loadWith(nav: Partial<Navigator> & { userAgentData?: { platform?: string } }) {
  vi.stubGlobal("navigator", nav);
  vi.resetModules();
  return import("./platform");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("platform", () => {
  it("names the Alt key the way each platform's keyboard does", async () => {
    const mac = await loadWith({ userAgentData: { platform: "macOS" } });
    expect(mac.IS_MAC).toBe(true);
    expect(mac.ALT_KEY).toBe("⌥ Option");

    const pc = await loadWith({ userAgentData: { platform: "Windows" } });
    expect(pc.IS_MAC).toBe(false);
    expect(pc.ALT_KEY).toBe("Alt");
  });

  it("falls back to the deprecated navigator.platform when userAgentData is absent", async () => {
    // Safari and Firefox still ship only this one.
    const { IS_MAC } = await loadWith({ platform: "MacIntel" } as Partial<Navigator>);
    expect(IS_MAC).toBe(true);
  });

  it("assumes non-Mac when the platform is unreadable", async () => {
    const { IS_MAC, ALT_KEY } = await loadWith({});
    expect(IS_MAC).toBe(false);
    expect(ALT_KEY).toBe("Alt");
  });
});
