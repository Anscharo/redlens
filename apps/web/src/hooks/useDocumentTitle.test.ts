// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, renderHook, cleanup } from "@testing-library/react";
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

  it("does not touch the title when inactive", () => {
    document.title = "Already set";
    renderHook(() => useDocumentTitle("Other", false));
    expect(document.title).toBe("Already set");
  });

  it("a parent title wins over a child page title", () => {
    function Child() {
      useDocumentTitle("Some Doc — Sky Atlas by Redline");
      return null;
    }
    function Parent() {
      useDocumentTitle("PR 88 preview on Sky Atlas by Redline -- feat/x");
      return createElement(Child);
    }
    render(createElement(Parent));
    expect(document.title).toBe("PR 88 preview on Sky Atlas by Redline -- feat/x");
  });

  it("a branch preview title wins when the preview is not a pull request", () => {
    function Child() {
      useDocumentTitle("Some Doc — Sky Atlas by Redline");
      return null;
    }
    function Parent() {
      useDocumentTitle("Preview feature on Sky Atlas by Redline");
      return createElement(Child);
    }
    render(createElement(Parent));
    expect(document.title).toBe("Preview feature on Sky Atlas by Redline");
  });

  it("restores the default title on unmount", () => {
    const { unmount } = renderHook(() => useDocumentTitle("Some Doc"));
    expect(document.title).toBe("Some Doc");
    unmount();
    expect(document.title).toBe(DEFAULT_TITLE);
  });
});
