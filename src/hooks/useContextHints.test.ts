// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useContextHints } from "./useContextHints";
import { hintStore } from "../lib/hintStore";
import { HOVER_HINTS, FOCUS_HINTS, SELF_MANAGED } from "../lib/hintText";

// jsdom has no PointerEvent, and pointerType is what the mouse-only guard reads.
function pointerOver(target: Element, pointerType = "mouse") {
  const e = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  target.dispatchEvent(e);
}
function pointerOut(target: Element, relatedTarget: Element | null = null) {
  target.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget }));
}

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  cleanup();
  root.remove();
  hintStore.setHover(null);
  hintStore.setFocus(null);
});

describe("useContextHints — pointer tier", () => {
  it("publishes the hint of the element under the cursor", () => {
    root.innerHTML = `<div data-mod-hint="split"><span id="t">row</span></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("#t")!);
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS.split);
  });

  it("resolves the innermost marker, so a chevron beats the row it sits in", () => {
    root.innerHTML = `<div data-mod-hint="split"><button id="c" data-mod-hint="cascade"></button></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("#c")!);
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS.cascade);
  });

  it("clears when the cursor moves onto something unmarked", () => {
    root.innerHTML = `<div data-mod-hint="split"></div><div id="plain"></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("[data-mod-hint]")!);
    pointerOver(root.querySelector("#plain")!);
    expect(hintStore.getSnapshot()).toBe(null);
  });

  // Clicking a collapsed chevron turns it into a collapse-everything control
  // without the cursor moving, so no pointerover fires to re-read the marker.
  it("follows the hovered element's marker when it changes under a still cursor", async () => {
    root.innerHTML = `<button id="c" data-mod-hint="cascade"></button>`;
    renderHook(() => useContextHints());
    const el = root.querySelector("#c")!;
    pointerOver(el);
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS.cascade);

    el.setAttribute("data-mod-hint", "cascade-collapse");
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver is async
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS["cascade-collapse"]);
  });

  it("stops following an element once the cursor leaves it", async () => {
    root.innerHTML = `<button id="c" data-mod-hint="cascade"></button><div id="plain"></div>`;
    renderHook(() => useContextHints());
    const el = root.querySelector("#c")!;
    pointerOver(el);
    pointerOver(root.querySelector("#plain")!);
    el.setAttribute("data-mod-hint", "cascade-collapse");
    await new Promise((r) => setTimeout(r, 0));
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("ignores touch, which fires pointerover on tap with no matching out", () => {
    root.innerHTML = `<div id="r" data-mod-hint="split"></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("#r")!, "touch");
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("clears when the pointer leaves the window entirely", () => {
    root.innerHTML = `<div id="r" data-mod-hint="split"></div>`;
    renderHook(() => useContextHints());
    const el = root.querySelector("#r")!;
    pointerOver(el);
    // Moving between elements carries a relatedTarget and must NOT clear —
    // the follow-up pointerover is what decides the next hint.
    pointerOut(el, root);
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS.split);
    pointerOut(el, null);
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("clears both tiers when the window loses focus", () => {
    root.innerHTML = `<div id="r" data-mod-hint="split"></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("#r")!);
    hintStore.setFocus("something");
    window.dispatchEvent(new Event("blur"));
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("stops listening once unmounted", () => {
    root.innerHTML = `<div id="r" data-mod-hint="split"></div>`;
    const { unmount } = renderHook(() => useContextHints());
    unmount();
    pointerOver(root.querySelector("#r")!);
    expect(hintStore.getSnapshot()).toBe(null);
  });
});

describe("useContextHints — focus tier", () => {
  it("publishes on focusin and clears on focusout", () => {
    root.innerHTML = `<div id="tree" tabindex="0" data-focus-hint="tree"></div>`;
    renderHook(() => useContextHints());
    const el = root.querySelector<HTMLElement>("#tree")!;
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS.tree);
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("leaves a self-managed element's hint alone on focusin", () => {
    root.innerHTML = `<input id="s" data-focus-hint="${SELF_MANAGED}" />`;
    renderHook(() => useContextHints());
    // Stand in for what useSearchFocusHint publishes just before this fires.
    hintStore.setFocus(FOCUS_HINTS["search-recents"]);
    root.querySelector("#s")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS["search-recents"]);
  });

  it("does not let a focus hint displace a hovered one", () => {
    root.innerHTML = `<div data-mod-hint="split"></div><div id="tree" data-focus-hint="tree"></div>`;
    renderHook(() => useContextHints());
    pointerOver(root.querySelector("[data-mod-hint]")!);
    root.querySelector("#tree")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(hintStore.getSnapshot()).toBe(HOVER_HINTS.split);
  });
});
