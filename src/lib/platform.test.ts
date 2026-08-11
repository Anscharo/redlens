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
  it("names the Mac keys on macOS", async () => {
    const { IS_MAC, ALT_KEY, MOD_KEY } = await loadWith({ userAgentData: { platform: "macOS" } });
    expect(IS_MAC).toBe(true);
    expect(ALT_KEY).toBe("⌥ Option");
    expect(MOD_KEY).toBe("⌘");
  });

  it("names the PC keys elsewhere", async () => {
    const { IS_MAC, ALT_KEY, MOD_KEY } = await loadWith({ userAgentData: { platform: "Windows" } });
    expect(IS_MAC).toBe(false);
    expect(ALT_KEY).toBe("Alt");
    expect(MOD_KEY).toBe("Ctrl");
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
