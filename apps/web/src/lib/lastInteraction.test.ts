// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  describeElement,
  installInteractionCapture,
  interactionTrail,
  resetInteractions,
  MAX_INTERACTIONS,
} from "./lastInteraction";

let uninstall: (() => void) | null = null;

beforeEach(() => {
  resetInteractions();
  document.body.innerHTML = "";
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe("describeElement", () => {
  it("describes a link by tag, class, relative href and label", () => {
    const el = mount('<a class="nav-link" href="/reports?q=1">Reports</a>');
    const out = describeElement(el)!;
    expect(out).toContain("a.nav-link");
    expect(out).toContain("[href=/reports?q=1]");
    expect(out).toContain('"Reports"');
  });

  it("strips the origin from an absolute href", () => {
    const el = mount('<a href="https://example.com/atlas?node=x">Doc</a>');
    expect(describeElement(el)).toContain("[href=/atlas?node=x]");
  });

  it("prefers aria-label over text content", () => {
    const el = mount('<button aria-label="Save collection">💾</button>');
    expect(describeElement(el)).toContain('"Save collection"');
  });

  it("resolves a click on a child up to the meaningful ancestor", () => {
    mount('<button id="send"><span>send</span></button>');
    const span = document.querySelector("span")!;
    expect(describeElement(span)).toContain("button#send");
  });

  it("carries the nearest data-node-id — the highest-signal field for triage", () => {
    mount('<div data-node-id="3f2a1b4c"><button>Expand</button></div>');
    const btn = document.querySelector("button")!;
    expect(describeElement(btn)).toContain("[node=3f2a1b4c]");
  });

  it("truncates a long label", () => {
    const el = mount(`<button>${"x".repeat(300)}</button>`);
    const out = describeElement(el)!;
    expect(out).toContain("…");
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("collapses whitespace in a label", () => {
    const el = mount("<button>  Save   the\n  thing </button>");
    expect(describeElement(el)).toContain('"Save the thing"');
  });

  it("redacts a secret that appears in a label", () => {
    const el = mount('<button aria-label="token sk-ABCDEFGHIJKLMNOP1234">Go</button>');
    const out = describeElement(el)!;
    expect(out).toContain("[key]");
    expect(out).not.toContain("sk-ABCDEFGHIJKLMNOP1234");
  });

  it("returns null for a null or non-element target", () => {
    expect(describeElement(null)).toBeNull();
    expect(describeElement({} as unknown as Element)).toBeNull();
  });
});

// The privacy contract. Each of these is a surface where the content is the
// user's own words rather than app chrome.
describe("describeElement — never captures user input", () => {
  it("identifies an input by name and NEVER by its value", () => {
    const el = mount('<input name="q" value="my secret search query" />');
    const out = describeElement(el)!;
    expect(out).toContain("input");
    expect(out).toContain("[name=q]");
    expect(out).not.toContain("my secret search query");
  });

  it("does not read a textarea's value either", () => {
    const el = mount("<textarea name=\"msg\">private draft text</textarea>");
    const out = describeElement(el)!;
    expect(out).not.toContain("private draft text");
  });

  it("ignores the chat panel entirely — that text is the user's own words", () => {
    mount('<section class="rlc-panel"><button>Copy answer</button></section>');
    expect(describeElement(document.querySelector("button"))).toBeNull();
  });

  it("ignores anything marked .ph-no-capture", () => {
    mount('<div class="ph-no-capture"><a href="/x">hit</a></div>');
    expect(describeElement(document.querySelector("a"))).toBeNull();
  });

  it("ignores the feedback trigger, so opening the modal never records itself", () => {
    const el = mount('<button data-feedback-ui aria-label="Send feedback">?</button>');
    expect(describeElement(el)).toBeNull();
  });
});

describe("installInteractionCapture", () => {
  it("records a pointerdown and reads back with an age prefix", () => {
    uninstall = installInteractionCapture();
    const el = mount('<a href="/reports">Reports</a>');
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const trail = interactionTrail();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatch(/^just now: a \[href=\/reports\] "Reports"$/);
  });

  it("records focusin too", () => {
    uninstall = installInteractionCapture();
    const el = mount("<button>Go</button>");
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(interactionTrail()).toHaveLength(1);
  });

  it("collapses pointerdown + focusin on the same target into one entry", () => {
    uninstall = installInteractionCapture();
    const el = mount("<button>Go</button>");
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(interactionTrail()).toHaveLength(1);
  });

  it(`keeps only the last ${MAX_INTERACTIONS}, oldest dropped`, () => {
    uninstall = installInteractionCapture();
    document.body.innerHTML = Array.from({ length: 8 }, (_, i) => `<button>b${i}</button>`).join("");
    for (const b of document.querySelectorAll("button")) {
      b.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    }
    const trail = interactionTrail();
    expect(trail).toHaveLength(MAX_INTERACTIONS);
    expect(trail[0]).toContain('"b3"'); // b0-b2 evicted
    expect(trail[MAX_INTERACTIONS - 1]).toContain('"b7"');
  });

  it("records nothing for an excluded subtree", () => {
    uninstall = installInteractionCapture();
    mount('<section class="rlc-panel"><button>Copy</button></section>');
    document.querySelector("button")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(interactionTrail()).toHaveLength(0);
  });

  it("stores strings only — no element references retained", () => {
    uninstall = installInteractionCapture();
    const el = mount("<button>Go</button>");
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.body.innerHTML = ""; // element detached
    expect(interactionTrail().every((e) => typeof e === "string")).toBe(true);
  });

  it("uninstall stops recording", () => {
    const stop = installInteractionCapture();
    stop();
    const el = mount("<button>Go</button>");
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(interactionTrail()).toHaveLength(0);
  });

  it("ages entries relative to the read time", () => {
    uninstall = installInteractionCapture();
    const el = mount("<button>Go</button>");
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(interactionTrail(Date.now() + 5_000)[0]).toMatch(/^5s ago:/);
    expect(interactionTrail(Date.now() + 120_000)[0]).toMatch(/^2m ago:/);
  });
});
