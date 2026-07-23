// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useDocumentTitle } from "./useDocumentTitle";

const DEFAULT_TITLE = "Sky Atlas by Redline";

afterEach(() => {
  cleanup();
  document.title = "";
});

describe("useDocumentTitle", () => {
  it("sets document.title to the given title", () => {
    renderHook(() => useDocumentTitle("Some Doc — Sky Atlas by Redline"));
    expect(document.title).toBe("Some Doc — Sky Atlas by Redline");
  });

  it("falls back to the default title when given null", () => {
    renderHook(() => useDocumentTitle(null));
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("falls back to the default title when given an empty string", () => {
    renderHook(() => useDocumentTitle(""));
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("falls back to the default title when given undefined", () => {
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("updates document.title when the title prop changes", () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "First" as string | null },
    });
    expect(document.title).toBe("First");
    rerender({ title: "Second" });
    expect(document.title).toBe("Second");
  });

  it("restores the default title on unmount", () => {
    const { unmount } = renderHook(() => useDocumentTitle("Some Doc"));
    expect(document.title).toBe("Some Doc");
    unmount();
    expect(document.title).toBe(DEFAULT_TITLE);
  });
});
