// @vitest-environment jsdom
// Regression test: SearchResults keys scroll restoration on the full query
// string, and stores its "show N more" pagination counter in the `n` param.
// Without excluding `n` from the restore key, clicking "show more" changes the
// key, the restore lookup misses, and the list jumps back to the top. See
// useScrollRestore's `excludeParams` option, threaded from SearchResults.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";

const saveScroll = vi.fn();
const getSavedScroll = vi.fn();

vi.mock("../lib/scrollMemory", () => ({
  saveScroll: (key: string, top: number) => saveScroll(key, top),
  getSavedScroll: (key: string) => getSavedScroll(key),
}));

import { useScrollRestore } from "./useScrollRestore";

function Harness({ excludeParams }: { excludeParams?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollRestore(ref, true, excludeParams);
  return <div ref={ref} data-testid="scroll-el" />;
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  saveScroll.mockClear();
  getSavedScroll.mockClear();
});

describe("useScrollRestore key derivation", () => {
  it("keys on the full query string when no params are excluded", () => {
    window.history.pushState({}, "", "/search?q=foo&n=40");
    const { unmount } = render(<Harness />);
    unmount(); // triggers the save-on-unmount cleanup
    expect(saveScroll).toHaveBeenCalledWith("/search?q=foo&n=40", 0);
  });

  it("excludes a pagination param (n) from the key so 'show more' keeps the saved position", () => {
    window.history.pushState({}, "", "/search?q=foo&n=40");
    const { unmount } = render(<Harness excludeParams={["n"]} />);
    unmount();
    // Same key regardless of `n` — proves paginating (n changes) won't miss the cache.
    expect(saveScroll).toHaveBeenCalledWith("/search?q=foo", 0);
  });

  it("restores using the n-excluded key, independent of the current n value", () => {
    getSavedScroll.mockReturnValue(123);
    window.history.pushState({}, "", "/search?q=foo&n=80");
    render(<Harness excludeParams={["n"]} />);
    expect(getSavedScroll).toHaveBeenCalledWith("/search?q=foo");
  });
});

// S4: the save-on-unmount cleanup used to read `el.scrollTop` directly, but
// for a real unmount that runs AFTER React detaches the element — a detached
// element has no layout box, so `.scrollTop` reads back 0 regardless of where
// the user actually scrolled, and that bogus 0 deleted the real saved
// position (scrollMemory.saveScroll treats <=0 as "nothing to remember").
// These tests drive the hook's own "scroll"-tracked ref instead of relying on
// jsdom's detach behavior (jsdom has no layout engine, so it never zeroes
// scrollTop on removal the way a real browser does) — the point is that the
// cleanup must use the last live-tracked value, not a fresh DOM read.
describe("useScrollRestore persists the last live scroll position, not a post-detach DOM read (S4)", () => {
  it("persists the scrollTop from the last 'scroll' event, even if the element reads 0 by unmount time", () => {
    window.history.pushState({}, "", "/search?q=foo");
    const { unmount, getByTestId } = render(<Harness />);
    const el = getByTestId("scroll-el");
    fireEvent.scroll(el, { target: { scrollTop: 400 } });
    // Simulate what a real detached element reports at cleanup time: no
    // layout box → 0, no matter where the user actually scrolled to.
    el.scrollTop = 0;
    unmount();
    expect(saveScroll).toHaveBeenCalledWith("/search?q=foo", 400);
  });

  it("tracks the latest of several scroll events, not just the first", () => {
    window.history.pushState({}, "", "/search?q=foo");
    const { unmount, getByTestId } = render(<Harness />);
    const el = getByTestId("scroll-el");
    fireEvent.scroll(el, { target: { scrollTop: 100 } });
    fireEvent.scroll(el, { target: { scrollTop: 550 } });
    unmount();
    expect(saveScroll).toHaveBeenCalledWith("/search?q=foo", 550);
  });

  it("persists a just-restored position even if the user never scrolls again before unmount", () => {
    getSavedScroll.mockReturnValue(250);
    window.history.pushState({}, "", "/restored-page");
    const { unmount } = render(<Harness />);
    // No "scroll" event fired — only the mount-time restore set scrollTop.
    unmount();
    expect(saveScroll).toHaveBeenLastCalledWith("/restored-page", 250);
  });

  it("still saves a genuine top position (0) as 0, not something stale from an earlier scroll", () => {
    window.history.pushState({}, "", "/search?q=foo");
    const { unmount, getByTestId } = render(<Harness />);
    const el = getByTestId("scroll-el");
    fireEvent.scroll(el, { target: { scrollTop: 300 } });
    fireEvent.scroll(el, { target: { scrollTop: 0 } }); // scrolled back to top
    unmount();
    expect(saveScroll).toHaveBeenCalledWith("/search?q=foo", 0);
  });
});
