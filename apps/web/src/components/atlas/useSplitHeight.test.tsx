// @vitest-environment jsdom
// useSplitHeight's clamping order (SPLIT_MIN_PX floor, SPLIT_DEFAULT_MAX_FRACTION
// cap on the undragged default, SPLIT_MAX_FRACTION cap on drag) is dense enough
// to get subtly wrong — see the Codex/Claude review findings on this file, and
// the split-pane-height-jump fix. jsdom has no real layout, so clientHeight/
// scrollHeight/offsetTop are stubbed at the prototype level to read from
// data-* attributes set directly in a small real-DOM harness component — this
// renders the hook's refs onto actual elements the way JuniorPane does, rather
// than patching detached nodes by hand, so mount-time effects see the right
// values immediately, matching real usage. ResizeObserver is a controllable
// fake: its constructor is captured so tests can fire callbacks on demand to
// simulate the browser's async delivery.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import {
  useSplitHeight,
  SPLIT_MIN_PX,
  SPLIT_DEFAULT_MAX_FRACTION,
  SPLIT_MAX_FRACTION,
} from "./useSplitHeight";

const STORAGE_KEY = "redline-sky-atlas:split-pane-height";

function attrNumber(el: Element, attr: string): number {
  const v = el.getAttribute(attr);
  return v == null ? 0 : Number(v);
}

let roCallbacks: (() => void)[] = [];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return attrNumber(this, "data-client-height");
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return attrNumber(this, "data-scroll-height");
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return attrNumber(this, "data-offset-top");
    },
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private cb: () => void;
    constructor(cb: () => void) {
      this.cb = cb;
      roCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      roCallbacks = roCallbacks.filter((c) => c !== this.cb);
    }
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  roCallbacks = [];
});

/** Simulates the browser delivering a queued ResizeObserver callback. */
function fireResizeObservers() {
  act(() => {
    for (const cb of roCallbacks) cb();
  });
}

function Harness({
  availPx,
  paneH,
  scrollerH,
  contentH,
  offsetTop,
  skeleton,
}: {
  availPx: number;
  paneH: number;
  scrollerH: number;
  contentH: number;
  offsetTop: number;
  skeleton?: boolean;
}) {
  const { paneRef, scrollerRef, contentRef, height } = useSplitHeight();
  return (
    <div data-client-height={String(availPx)}>
      <div ref={paneRef} data-client-height={String(paneH)} style={{ position: "relative" }}>
        <div ref={scrollerRef} data-client-height={String(scrollerH)} data-offset-top={String(offsetTop)}>
          <div ref={contentRef} data-scroll-height={String(contentH)}>
            {skeleton && <div data-node-content-skeleton />}
          </div>
        </div>
      </div>
      <div data-testid="height">{String(height)}</div>
    </div>
  );
}

function height(): string {
  return screen.getByTestId("height").textContent ?? "";
}

describe("useSplitHeight", () => {
  it("defaults to the doc's own size when it fits under the default cap", () => {
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={200} offsetTop={30} />);
    // contentPx = 200 + 30 = 230, well under the 50% cap (500).
    expect(height()).toBe("230");
  });

  it("caps the undragged default at SPLIT_DEFAULT_MAX_FRACTION even for a much taller doc", () => {
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={5000} offsetTop={30} />);
    expect(height()).toBe(String(Math.round(1000 * SPLIT_DEFAULT_MAX_FRACTION)));
  });

  it("floors at SPLIT_MIN_PX for a very short doc", () => {
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={10} offsetTop={5} />);
    expect(height()).toBe(String(SPLIT_MIN_PX));
  });

  it("allows a stored/dragged height up to SPLIT_MAX_FRACTION of the column", () => {
    localStorage.setItem(STORAGE_KEY, "900");
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={200} offsetTop={30} />);
    // maxPx = round(1000 * 0.6) = 600 — the 900 stored value is clamped to it.
    expect(height()).toBe(String(Math.round(1000 * SPLIT_MAX_FRACTION)));
  });

  it("ignores a stored height below SPLIT_MIN_PX (readStored discards it)", () => {
    localStorage.setItem(STORAGE_KEY, "10");
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={200} offsetTop={30} />);
    // Falls back to the content-fit default, not the too-small stored value.
    expect(height()).toBe("230");
  });

  it("does not shrink to a Suspense skeleton's height — skips measuring while one is present", () => {
    render(<Harness availPx={1000} paneH={400} scrollerH={370} contentH={50} offsetTop={30} skeleton />);
    // Skeleton present: contentPx is never set, so the default cap is used
    // rather than fitting the skeleton's (unrepresentative) short height.
    expect(height()).toBe(String(Math.round(1000 * SPLIT_DEFAULT_MAX_FRACTION)));

    // The real ResizeObserver would fire once the skeleton is replaced by real
    // content; simulate that delivery directly.
    fireResizeObservers();
    expect(height()).toBe(String(Math.round(1000 * SPLIT_DEFAULT_MAX_FRACTION)));
  });
});
