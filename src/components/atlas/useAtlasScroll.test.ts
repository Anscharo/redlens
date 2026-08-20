// @vitest-environment jsdom
// useAtlasScroll scrolls the selected doc into view on navigation, and also when
// the reader flips view mode (all ⇄ selected-only ⇄ changed) — otherwise leaving
// "selected only" leaves the current node scrolled off-screen.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAtlasScroll } from "./useAtlasScroll";
import { scrollIfOutOfView } from "@/lib/animatedScroll";
import { makeLoadedData } from "../../test/fixtures";

vi.mock("@/lib/animatedScroll", () => ({ scrollIfOutOfView: vi.fn() }));

const scrollMock = vi.mocked(scrollIfOutOfView);
const data = makeLoadedData();
const EMPTY = new Map();

let rafSpy: ReturnType<typeof vi.spyOn>;
let getByIdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollMock.mockClear();
  rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  // Every id resolves to some element, so the scroll path runs.
  getByIdSpy = vi
    .spyOn(document, "getElementById")
    .mockImplementation(() => document.createElement("div"));
});

afterEach(() => {
  rafSpy.mockRestore();
  getByIdSpy.mockRestore();
});

describe("useAtlasScroll", () => {
  it("scrolls to the doc on mount and re-scrolls when the id changes", () => {
    const { rerender } = renderHook(
      ({ id, view }) => useAtlasScroll(id, data, EMPTY, view),
      { initialProps: { id: "a", view: "all" } },
    );
    expect(scrollMock).toHaveBeenCalledTimes(1);

    // Same id + view again → no extra scroll (guarded by scrolledRef).
    rerender({ id: "a", view: "all" });
    expect(scrollMock).toHaveBeenCalledTimes(1);

    // Navigating to a different id re-scrolls.
    rerender({ id: "b", view: "all" });
    expect(scrollMock).toHaveBeenCalledTimes(2);
  });

  it("re-scrolls to the SAME doc when the view mode flips (leaving selected-only)", () => {
    const { rerender } = renderHook(
      ({ id, view }) => useAtlasScroll(id, data, EMPTY, view),
      { initialProps: { id: "a", view: "selected" } },
    );
    expect(scrollMock).toHaveBeenCalledTimes(1);

    // Click "All": id is unchanged but the view flips — must re-scroll so the
    // selected node stays in view.
    rerender({ id: "a", view: "all" });
    expect(scrollMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-glide after the user has scrolled by hand (data swaps identity later)", () => {
    const { rerender } = renderHook(
      ({ id, data: d }) => useAtlasScroll(id, d, EMPTY, "all"),
      { initialProps: { id: "a", data } },
    );
    expect(scrollMock).toHaveBeenCalledTimes(1);

    // User scrolls elsewhere by hand.
    window.dispatchEvent(new Event("wheel"));

    // The shallow→full bundle swap gives `data` a new identity a few seconds
    // later — this must NOT recenter the reader out from under the user.
    const dataV2 = makeLoadedData();
    rerender({ id: "a", data: dataV2 });
    expect(scrollMock).toHaveBeenCalledTimes(1);
  });

  it("still glides once on a fresh id even after the user has moved (guard resets per id)", () => {
    const { rerender } = renderHook(
      ({ id, data: d }) => useAtlasScroll(id, d, EMPTY, "all"),
      { initialProps: { id: "a", data } },
    );
    expect(scrollMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("wheel"));
    rerender({ id: "a", data }); // data unchanged, wheel alone shouldn't matter here
    expect(scrollMock).toHaveBeenCalledTimes(1);

    // Deep link / navigation to a new id resets the guard — the auto-glide
    // to a fresh selection must still fire.
    rerender({ id: "b", data });
    expect(scrollMock).toHaveBeenCalledTimes(2);
  });
});
