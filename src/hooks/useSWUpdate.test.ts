// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stand-in for the virtual PWA module. vitest.config.ts aliases the
// specifier to a stub so it resolves; this mock replaces it with one we can drive.
const mockState: {
  options: {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (url: string, reg?: { update: () => void }) => void;
  } | null;
  needRefresh: boolean;
  updateSW: ReturnType<typeof vi.fn>;
} = { options: null, needRefresh: false, updateSW: vi.fn(async () => {}) };

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: Record<string, unknown>) => {
    mockState.options = options as (typeof mockState)["options"];
    return {
      needRefresh: [mockState.needRefresh, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: mockState.updateSW,
    };
  },
}));

import { useSWUpdate } from "./useSWUpdate";

function stubServiceWorker(reg: Partial<ServiceWorkerRegistration> | null) {
  const addEventListener = vi.fn();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      addEventListener,
      ready: reg ? Promise.resolve(reg) : Promise.reject(new Error("no reg")),
    },
  });
  return addEventListener;
}

beforeEach(() => {
  mockState.options = null;
  mockState.needRefresh = false;
  mockState.updateSW = vi.fn(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error remove the stub between tests
  delete navigator.serviceWorker;
});

describe("useSWUpdate", () => {
  it("exposes needRefresh from the registration and an applyUpdate function", () => {
    mockState.needRefresh = true;
    const { result } = renderHook(() => useSWUpdate());
    expect(result.current.needRefresh).toBe(true);
    expect(typeof result.current.applyUpdate).toBe("function");
  });

  it("applyUpdate triggers the service worker update and reloads on controllerchange", () => {
    const addEventListener = stubServiceWorker({});
    const { result } = renderHook(() => useSWUpdate());

    act(() => result.current.applyUpdate());

    expect(mockState.updateSW).toHaveBeenCalledWith(true);
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), { once: true });
  });

  it("auto-applies a waiting worker on a fresh page open (onNeedRefresh within the grace window)", async () => {
    const postMessage = vi.fn();
    const addEventListener = stubServiceWorker({ waiting: { postMessage } as unknown as ServiceWorker });
    renderHook(() => useSWUpdate());

    await act(async () => {
      mockState.options?.onNeedRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), { once: true });
  });

  it("does not post SKIP_WAITING when there is no waiting worker", async () => {
    const postMessage = vi.fn();
    stubServiceWorker({ waiting: null });
    renderHook(() => useSWUpdate());

    await act(async () => {
      mockState.options?.onNeedRefresh?.();
      await Promise.resolve();
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("onRegisteredSW schedules hourly checks and re-checks when the tab becomes visible", () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi.fn();

    act(() => mockState.options?.onRegisteredSW?.("/sw.js", { update }));

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("onRegisteredSW is a no-op without a registration", () => {
    renderHook(() => useSWUpdate());
    expect(() => mockState.options?.onRegisteredSW?.("/sw.js", undefined)).not.toThrow();
  });
});
