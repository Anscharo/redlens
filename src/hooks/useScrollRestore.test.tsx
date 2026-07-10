// @vitest-environment jsdom
// Regression test: SearchResults keys scroll restoration on the full query
// string, and stores its "show N more" pagination counter in the `n` param.
// Without excluding `n` from the restore key, clicking "show more" changes the
// key, the restore lookup misses, and the list jumps back to the top. See
// useScrollRestore's `excludeParams` option, threaded from SearchResults.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
  return <div ref={ref} />;
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
