// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { layoutMscFlow } from "../lib/mscFlowLayout";
import { useTweened } from "./useTweened";
import { useTweenedFlow } from "./useTweenedFlow";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubMotion({ reduce }: { reduce: boolean }) {
  const queued: FrameRequestCallback[] = [];
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && String(q).includes("reduce"),
  }));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
    queued.push(fn);
    return queued.length;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return { queued, cancel };
}

describe("useTweened", () => {
  it("snaps to the new target when motion is reduced", () => {
    stubMotion({ reduce: true });
    const lerp = vi.fn((from: number, to: number) => from + to);
    const { result, rerender } = renderHook(({ t }) => useTweened(t, lerp, 100), {
      initialProps: { t: 0 },
    });
    rerender({ t: 10 });
    expect(result.current).toBe(10);
    expect(lerp).not.toHaveBeenCalled();
  });

  it("lerps on animation frames and settles on the target", () => {
    const { queued } = stubMotion({ reduce: false });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const lerp = (from: number, to: number, k: number) => from + (to - from) * k;
    const { result, rerender } = renderHook(({ t }) => useTweened(t, lerp, 100), {
      initialProps: { t: 0 },
    });
    rerender({ t: 100 });
    expect(queued).toHaveLength(1);
    act(() => queued[0]!(50));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);
    act(() => queued[1]!(100));
    expect(result.current).toBe(100);
  });

  it("cancels the in-flight frame on unmount", () => {
    const { queued, cancel } = stubMotion({ reduce: false });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { rerender, unmount } = renderHook(({ t }) => useTweened(t, (a, b, k) => a + (b - a) * k, 100), {
      initialProps: { t: 0 },
    });
    rerender({ t: 8 });
    expect(queued).toHaveLength(1);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});

describe("useTweenedFlow", () => {
  it("returns the flow layout, snapping in the test environment", () => {
    const layout = layoutMscFlow([
      {
        prime: "spark",
        month: "2026-07",
        sky: 10,
        kept: 2,
        demand: 1,
        cof: 9,
        sde: 1,
        demandParts: { agentRate: 1 },
        latestMonth: "2026-07",
      },
    ]);
    const { result } = renderHook(() => useTweenedFlow(layout));
    expect(result.current).toBe(layout);
  });
});
