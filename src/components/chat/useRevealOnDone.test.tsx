// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRevealOnDone } from "./useRevealOnDone";

afterEach(() => {
  document.body.classList.remove("rlc-nomotion");
});

describe("useRevealOnDone", () => {
  it("mirrors content immediately when done is already true on mount (loaded/historical message)", () => {
    const { result } = renderHook(() => useRevealOnDone("Already finished.", true));
    expect(result.current.display).toBe("Already finished.");
    expect(result.current.revealing).toBe(false);
  });

  it("does not touch display while !done, even as content grows (streaming tokens)", () => {
    const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
      initialProps: { content: "", done: false },
    });
    rerender({ content: "Hel", done: false });
    rerender({ content: "Hello", done: false });
    expect(result.current.revealing).toBe(false);
  });

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("animates once when content was empty right before done flips true", () => {
      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "", done: false },
      });
      const full = "The final, verified answer.";
      act(() => rerender({ content: full, done: true }));
      expect(result.current.revealing).toBe(true);
      expect(result.current.display).not.toBe(full);

      act(() => vi.advanceTimersByTime(3000));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe(full);
    });

    it("does not animate when content was already present before done (streaming-mode done)", () => {
      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "Hello", done: false },
      });
      act(() => rerender({ content: "Hello world", done: true }));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe("Hello world");
    });

    it("does not re-trigger on a later render once already done", () => {
      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "", done: false },
      });
      const full = "Answer.";
      act(() => rerender({ content: full, done: true }));
      act(() => vi.advanceTimersByTime(3000));
      expect(result.current.display).toBe(full);

      // A later re-render with the same done/content (e.g. a sibling prop
      // changed) must not restart the animation.
      act(() => rerender({ content: full, done: true }));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe(full);
    });

    it("reveals instantly under prefers-reduced-motion (rlc-nomotion body class)", () => {
      document.body.classList.add("rlc-nomotion");
      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "", done: false },
      });
      const full = "Instant.";
      act(() => rerender({ content: full, done: true }));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe(full);
    });

    it("reveals instantly under prefers-reduced-motion (matchMedia)", () => {
      const realMatchMedia = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
        onchange: null,
      })) as unknown as typeof window.matchMedia;

      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "", done: false },
      });
      const full = "Instant via OS setting.";
      act(() => rerender({ content: full, done: true }));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe(full);

      window.matchMedia = realMatchMedia;
    });

    it("does not animate an empty final answer (aborted staged turn)", () => {
      const { result, rerender } = renderHook(({ content, done }) => useRevealOnDone(content, done), {
        initialProps: { content: "", done: false },
      });
      act(() => rerender({ content: "", done: true }));
      expect(result.current.revealing).toBe(false);
      expect(result.current.display).toBe("");
    });
  });
});
