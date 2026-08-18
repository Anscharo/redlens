// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stand-in for the virtual PWA module. vitest.config.ts aliases the
// specifier to a stub so it resolves; this mock replaces it with one we can drive.
const mockState: {
  options: {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (url: string, reg?: { update: () => unknown; unregister?: () => unknown }) => void;
  } | null;
  needRefresh: boolean;
  updateSW: ReturnType<typeof vi.fn>;
} = { options: null, needRefresh: false, updateSW: vi.fn(async () => {}) };

const captureException = vi.fn();
const track = vi.fn();
vi.mock("../lib/analytics", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  track: (...a: unknown[]) => track(...a),
}));

type UpdateFn = () => Promise<void>;

/** Registration double: `update` resolves or rejects on demand. */
function reg(update: UpdateFn) {
  return { update, unregister: vi.fn(async () => true) };
}

/** Drive the hourly timer n times, flushing the microtasks each tick queues. */
async function tickHours(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function setVisible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

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
  captureException.mockClear();
  track.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
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

  it("applyUpdate triggers the service worker update and arms a reload fallback", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    const { result } = renderHook(() => useSWUpdate());

    act(() => result.current.applyUpdate());

    expect(mockState.updateSW).toHaveBeenCalledWith(true);
    // vite-plugin-pwa's own `controlling` listener normally reloads first (see
    // showSkipWaitingPrompt) — this is only the fallback for when there's no
    // waiting worker to activate (e.g. the pill was raised by useBuildBehind).
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1500));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("onNeedRefresh tracks the event instead of silently applying the update", async () => {
    const postMessage = vi.fn();
    stubServiceWorker({ waiting: { postMessage } as unknown as ServiceWorker });
    renderHook(() => useSWUpdate());

    await act(async () => {
      mockState.options?.onNeedRefresh?.();
      await Promise.resolve();
    });

    // The pill (needRefresh, set by the library) is the only apply path — no
    // auto-SKIP_WAITING on a fresh page open.
    expect(postMessage).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("sw_update_available");
  });

  it("schedules hourly checks once a registration arrives", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi.fn(async () => {});
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await tickHours(2);

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("throttles the visibility re-check to one per 30 minutes", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi.fn(async () => {});
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await tickHours(1);
    expect(update).toHaveBeenCalledTimes(1);

    // Immediately after the hourly check — inside the window, so no fetch.
    act(() => setVisible("visible"));
    expect(update).toHaveBeenCalledTimes(1);

    // 31 minutes later the window has passed (the interval itself is not due
    // again until the 2h mark, so this can only be the visibility path).
    await act(async () => {
      vi.advanceTimersByTime(31 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => setVisible("visible"));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("ignores visibilitychange when the tab is being hidden", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi.fn(async () => {});
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await act(async () => {
      vi.advanceTimersByTime(31 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => setVisible("hidden"));

    expect(update).not.toHaveBeenCalled();
  });

  it("skips the check while offline instead of manufacturing a rejection", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    renderHook(() => useSWUpdate());
    const update = vi.fn(async () => {});
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await tickHours(3);

    expect(update).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  // A rejection that escaped would be an uncaught TypeError — which is exactly
  // what filled PostHog error tracking. Polling surviving two rejections and a
  // recovery is only possible if each one was caught.
  it("swallows a failed check and keeps polling below the give-up threshold", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi
      .fn<UpdateFn>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(undefined);
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await tickHours(4);

    expect(update).toHaveBeenCalledTimes(4);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("resets the failure count after a successful check", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi
      .fn<UpdateFn>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new TypeError("fetch failed"));
    const registration = reg(update);
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", registration));

    // 2 fail, 1 succeeds (count back to 0), then 2 more fail — still under 3.
    await tickHours(5);

    expect(registration.unregister).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("gives up, unregisters, and reports once after 3 consecutive failures", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    const update = vi.fn<UpdateFn>().mockRejectedValue(new TypeError("fetch failed"));
    const registration = reg(update);
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", registration));

    await tickHours(6);

    // Polling stops at the threshold rather than re-rejecting every hour.
    expect(update).toHaveBeenCalledTimes(3);
    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ mechanism: "sw.update", $exception_fingerprint: "sw-update-unreachable" }),
    );
  });

  it("stops checking after unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useSWUpdate());
    const update = vi.fn(async () => {});
    act(() => mockState.options?.onRegisteredSW?.("/sw.js", reg(update)));

    await tickHours(1);
    expect(update).toHaveBeenCalledTimes(1);

    unmount();
    await tickHours(3);
    act(() => setVisible("visible"));

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("onRegisteredSW is a no-op without a registration", async () => {
    vi.useFakeTimers();
    renderHook(() => useSWUpdate());
    expect(() => mockState.options?.onRegisteredSW?.("/sw.js", undefined)).not.toThrow();
    await tickHours(1);
    expect(captureException).not.toHaveBeenCalled();
  });
});
