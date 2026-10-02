// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type * as ThemeModule from "./theme";

const KEY = "redline-sky-atlas:theme";

// theme.ts caches its snapshot at module-import time (same reasoning as
// recentSearches.ts) — a fresh module instance per test keeps that cache,
// and localStorage seeded before import, from bleeding across tests.
async function freshModule(): Promise<typeof ThemeModule> {
  vi.resetModules();
  return import("./theme");
}

// jsdom ships no matchMedia, so the OS-preference path is invisible without a
// stub — every test below would silently exercise the `undefined` branch and
// pass for the wrong reason. Install BEFORE freshModule(): theme.ts reads the
// preference at module-import time to seed its snapshot.
function stubSystem(prefersLight: boolean): { flip: (toLight: boolean) => void } {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = prefersLight;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return query.includes("light") ? matches : !matches;
      },
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    }),
  });
  return {
    flip: (toLight: boolean) => {
      matches = toLight;
      for (const fn of listeners) fn({ matches: toLight } as MediaQueryListEvent);
    },
  };
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
  document.head.innerHTML = '<meta name="theme-color" content="#160e0d" />';
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
});

describe("useTheme", () => {
  it("defaults to INITIAL_THEME (light) with empty storage", async () => {
    const { useTheme, INITIAL_THEME } = await freshModule();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe(INITIAL_THEME);
    expect(INITIAL_THEME).toBe("light");
  });

  // Garbage or unrecognised storage falls back to the DEFAULT_THEME, never a
  // partial match — "Light" (wrong case) and "" are both real values a stale
  // client or a manual edit could leave behind, and neither is "light".
  it.each(["solarized-neon", "", "Light"])(
    "falls back to INITIAL_THEME for stored value %j",
    async (stored) => {
      localStorage.setItem(KEY, stored);
      const { useTheme, INITIAL_THEME } = await freshModule();
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe(INITIAL_THEME);
    },
  );

  it("setTheme('light') sets data-theme AND data-scheme, persists the plain string, and updates theme-color", async () => {
    const { useTheme, THEMES } = await freshModule();
    const light = THEMES.find((t) => t.id === "light")!;
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));

    expect(result.current.theme).toBe("light");
    expect(result.current.scheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-scheme")).toBe("light");
    expect(localStorage.getItem(KEY)).toBe("light");
    expect(themeColor()).toBe(light.bg);
  });

  it("setTheme('dark') sets data-scheme to dark", async () => {
    const { useTheme } = await freshModule();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    act(() => result.current.setTheme("dark"));

    expect(document.documentElement.getAttribute("data-scheme")).toBe("dark");
    expect(result.current.scheme).toBe("dark");
  });

  it("syncs the snapshot on a cross-tab storage event", async () => {
    const { useTheme } = await freshModule();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => {
      localStorage.setItem(KEY, "dark");
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current.theme).toBe("dark");

    act(() => {
      localStorage.setItem(KEY, "light");
      window.dispatchEvent(new Event("storage"));
    });

    expect(result.current.theme).toBe("light");
  });

  it("does not crash when localStorage throws, and does not clobber the in-memory snapshot", async () => {
    const { useTheme } = await freshModule();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("private mode");
    };
    try {
      const { result } = renderHook(() => useTheme());
      expect(() => act(() => result.current.setTheme("light"))).not.toThrow();
      // Still applied for this session even though persistence failed — and
      // the hook's own state must agree with the DOM, or the picker shows
      // the old row selected while the page is visibly on the new theme.
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(result.current.theme).toBe("light");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("schemeOf / isThemeId", () => {
  it("agree with every registry entry's declared id and scheme", async () => {
    const { THEMES, schemeOf, isThemeId } = await freshModule();
    for (const t of THEMES) {
      expect(isThemeId(t.id)).toBe(true);
      expect(schemeOf(t.id)).toBe(t.scheme);
    }
  });

  it("isThemeId rejects unknown values", async () => {
    const { isThemeId } = await freshModule();
    expect(isThemeId("solarized")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId("Light")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });
});

describe("applyTheme", () => {
  it("is idempotent — applying the same theme twice is a no-op change", async () => {
    const { applyTheme, THEMES } = await freshModule();
    for (const t of THEMES) {
      applyTheme(t.id);
      const before = {
        theme: document.documentElement.getAttribute("data-theme"),
        scheme: document.documentElement.getAttribute("data-scheme"),
        color: themeColor(),
      };
      applyTheme(t.id);
      expect(document.documentElement.getAttribute("data-theme")).toBe(before.theme);
      expect(document.documentElement.getAttribute("data-scheme")).toBe(before.scheme);
      expect(themeColor()).toBe(before.color);
    }
  });

  it("sets data-theme for the default explicitly (not removed)", async () => {
    const { applyTheme, DEFAULT_THEME, THEMES } = await freshModule();
    const dark = THEMES.find((t) => t.id === DEFAULT_THEME)!;
    applyTheme(DEFAULT_THEME);
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_THEME);
    expect(themeColor()).toBe(dark.bg);
  });

  it("is a no-op-safe when the theme-color meta is missing", async () => {
    const { applyTheme } = await freshModule();
    document.head.innerHTML = "";
    expect(() => applyTheme("light")).not.toThrow();
  });
});

// The OS preference is ignored: light is the initial theme either way, and a
// stored pick always wins.
describe("system colour-scheme preference", () => {
  it.each([true, false])("uses INITIAL_THEME when the device prefers light=%s", async (prefersLight) => {
    stubSystem(prefersLight);
    const { useTheme, INITIAL_THEME } = await freshModule();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe(INITIAL_THEME);
    expect(result.current.scheme).toBe("light");
  });

  it("lets a stored choice outrank the initial theme", async () => {
    stubSystem(true);
    localStorage.setItem(KEY, "giedi");
    const { useTheme } = await freshModule();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("giedi");
  });

  it("does not follow the device flipping", async () => {
    const sys = stubSystem(false);
    const { useTheme } = await freshModule();
    const { result } = renderHook(() => useTheme());
    act(() => sys.flip(false));
    act(() => sys.flip(true));
    expect(result.current.theme).toBe("light");
  });
});
