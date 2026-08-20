// @vitest-environment jsdom
// applyOverrides/clearInlineOverrides drive document.documentElement.style
// directly — the same mechanism index.html's pre-paint script and the palette
// editor's "apply" button use. cssDefault is the one function that has to see
// through a live override to find the underlying index.css value, or "reset
// to default" and the CSS snippet export both end up comparing a token
// against its own override instead of the real default.
import { describe, it, expect, afterEach } from "vitest";
import { applyOverrides, clearInlineOverrides, cssDefault } from "./palette-storage";

function styleTag(css: string) {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
  return el;
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.head.querySelectorAll("style").forEach((el) => el.remove());
});

describe("applyOverrides / clearInlineOverrides", () => {
  it("sets each value as a --prefixed inline custom property", () => {
    applyOverrides({ bg: "#111111", accent: "#c9a08a" });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--bg")).toBe("#111111");
    expect(root.style.getPropertyValue("--accent")).toBe("#c9a08a");
  });

  it("clearInlineOverrides removes exactly the named properties, leaving the rest", () => {
    applyOverrides({ bg: "#111111", accent: "#c9a08a" });
    clearInlineOverrides(["bg"]);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--bg")).toBe("");
    expect(root.style.getPropertyValue("--accent")).toBe("#c9a08a");
  });

  it("clearInlineOverrides on a never-set property is a no-op, not a throw", () => {
    expect(() => clearInlineOverrides(["never-set"])).not.toThrow();
  });
});

describe("cssDefault", () => {
  it("reads the stylesheet value of a custom property that has no inline override", () => {
    styleTag(":root { --cd-plain: rgb(1, 2, 3); }");
    expect(cssDefault("cd-plain")).toBe("rgb(1,2,3)");
  });

  it("sees through a live inline override to the stylesheet default, then restores the override", () => {
    styleTag(":root { --cd-override: rgb(4, 5, 6); }");
    const root = document.documentElement;
    root.style.setProperty("--cd-override", "rgb(9, 9, 9)");

    expect(cssDefault("cd-override")).toBe("rgb(4,5,6)");
    // The live value the user is currently previewing must survive the read —
    // cssDefault only borrows the property momentarily to see past it.
    expect(root.style.getPropertyValue("--cd-override")).toBe("rgb(9, 9, 9)");
  });

  it("caches the result — a later stylesheet change isn't picked up on a repeat call", () => {
    const tag = styleTag(":root { --cd-cached: rgb(1, 1, 1); }");
    expect(cssDefault("cd-cached")).toBe("rgb(1,1,1)");
    tag.textContent = ":root { --cd-cached: rgb(2, 2, 2); }";
    expect(cssDefault("cd-cached")).toBe("rgb(1,1,1)");
  });
});
