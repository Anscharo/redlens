// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AnchoredResizeHandle } from "./AnchoredResizeHandle";
import { ANCHORED_WIDTH_KEY } from "./anchoredWidth";

const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

function setViewport(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px });
  window.dispatchEvent(new Event("resize"));
}

function renderHandle(panelWidth = 400) {
  return render(
    <section data-w={String(panelWidth)}>
      <AnchoredResizeHandle />
    </section>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--rlc-anchored-w");
  document.body.classList.remove("rlc-resizing");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return Number((this as HTMLElement).dataset.w ?? 0);
    },
  });
  setViewport(1400);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.removeProperty("--rlc-anchored-w");
  document.body.classList.remove("rlc-resizing");
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
});

describe("AnchoredResizeHandle", () => {
  it("leaves the responsive default in place until the user drags", () => {
    renderHandle();
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("");
    const handle = screen.getByRole("separator", { name: "Resize chat" });
    expect(handle).toHaveAttribute("aria-valuenow", "400");
    expect(handle).toHaveAttribute("aria-valuemin", "340");
    expect(handle).toHaveAttribute("aria-valuemax", String(Math.floor(1400 * 0.55)));
  });

  it("grows when dragged left and stops at 55% of the window", () => {
    renderHandle(400);
    const handle = screen.getByRole("separator", { name: "Resize chat" });
    fireEvent.mouseDown(handle, { clientX: 200 });
    expect(document.body.classList.contains("rlc-resizing")).toBe(true);
    fireEvent.mouseMove(window, { clientX: 120 });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("480px");
    fireEvent.mouseMove(window, { clientX: -4000 });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("770px");
    fireEvent.mouseUp(window);
    expect(document.body.classList.contains("rlc-resizing")).toBe(false);
    expect(localStorage.getItem(ANCHORED_WIDTH_KEY)).toBe("770");
  });

  it("does not shrink past the 340px floor", () => {
    renderHandle(400);
    fireEvent.mouseDown(screen.getByRole("separator", { name: "Resize chat" }), { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 4000 });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("340px");
    fireEvent.mouseUp(window);
  });

  it("applies a stored width, clamped to the window, and restores it when the window grows", () => {
    localStorage.setItem(ANCHORED_WIDTH_KEY, "800");
    setViewport(1000);
    renderHandle();
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("550px");
    expect(localStorage.getItem(ANCHORED_WIDTH_KEY)).toBe("800");
    act(() => setViewport(1600));
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("800px");
  });

  it("resizes from the keyboard and remembers the width", async () => {
    renderHandle(400);
    const handle = screen.getByRole("separator", { name: "Resize chat" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("424px");
    expect(localStorage.getItem(ANCHORED_WIDTH_KEY)).toBe("424");
    fireEvent.keyDown(handle, { key: "End" });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("770px");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("340px");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("340px");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.body.classList.contains("rlc-resizing")).toBe(false);
  });

  it("hides the handle and does not override the width on a narrow window", () => {
    localStorage.setItem(ANCHORED_WIDTH_KEY, "600");
    setViewport(500);
    renderHandle();
    expect(screen.queryByRole("separator", { name: "Resize chat" })).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("");
  });

  it("clears the width override when the handle unmounts", () => {
    localStorage.setItem(ANCHORED_WIDTH_KEY, "600");
    const { unmount } = renderHandle();
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("600px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--rlc-anchored-w")).toBe("");
  });
});
