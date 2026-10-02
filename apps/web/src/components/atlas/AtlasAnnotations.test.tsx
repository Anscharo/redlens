// @vitest-environment jsdom
// AtlasAnnotations is the resizable right-column wrapper: it owns the panel
// width (persisted in localStorage, clamped to [MIN, MAX], else a default) and
// hosts RightPanel behind an error boundary. useGraphEdges is worker-backed, so
// it's stubbed; RightPanel renders for real. These cases pin the width
// initializer branches (default / valid stored / out-of-range stored) and that
// the panel content mounts.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../hooks/useGraphEdges", () => ({
  useGraphEdges: () => ({ outbound: [], inbound: [] }),
}));

import { AtlasAnnotations } from "./AtlasAnnotations";

const RIGHT_PANEL_KEY = "redline-sky-atlas:right-panel-width";
const RIGHT_PANEL_DEFAULT = 520;

type Tab = "notes" | "glossary" | "history";

function setup(over: Partial<Parameters<typeof AtlasAnnotations>[0]> = {}) {
  const props = {
    id: "node-1",
    annotationDocs: [],
    linkedNodes: [],
    cousinDocs: [],
    targetAddresses: {},
    chainValues: {},
    glossaryTerms: [],
    annotationCount: 0,
    tab: "notes" as Tab,
    onTabChange: vi.fn(),
    onNavigate: vi.fn(),
    onNavigateByDocNo: vi.fn(),
    ...over,
  };
  return render(<AtlasAnnotations {...props} />);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("AtlasAnnotations width persistence", () => {
  it("falls back to the default width when nothing is stored", () => {
    const { container } = setup();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveStyle({ width: `${RIGHT_PANEL_DEFAULT}px` });
  });

  it("restores a valid stored width", () => {
    localStorage.setItem(RIGHT_PANEL_KEY, "600");
    const { container } = setup();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveStyle({ width: "600px" });
  });

  it("ignores an out-of-range stored width and uses the default", () => {
    localStorage.setItem(RIGHT_PANEL_KEY, "99999");
    const { container } = setup();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveStyle({ width: `${RIGHT_PANEL_DEFAULT}px` });
  });

  it("ignores a non-numeric stored width and uses the default", () => {
    localStorage.setItem(RIGHT_PANEL_KEY, "not-a-number");
    const { container } = setup();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveStyle({ width: `${RIGHT_PANEL_DEFAULT}px` });
  });

  it("mounts the RightPanel jump pills inside the wrapper", () => {
    setup();
    expect(screen.getByRole("navigation", { name: "Panel sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notes/ })).toBeInTheDocument();
  });
});

// The panel measures #atlas-reader-row and gives the document 400px before
// taking any width of its own. jsdom has no ResizeObserver, so these cases
// install one and drive it.
type RowObserver = {
  cb: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function stubMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
}

describe("AtlasAnnotations reader space", () => {
  const observers: RowObserver[] = [];
  let row: HTMLDivElement;
  let rowPx = 0;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: ResizeObserverCallback;
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
          observers.push(this);
        }
      },
    );
    stubMatchMedia(false);
    rowPx = 0;
    row = document.createElement("div");
    row.id = "atlas-reader-row";
    Object.defineProperty(row, "clientWidth", { configurable: true, get: () => rowPx });
    document.body.appendChild(row);
  });

  afterEach(() => {
    row.remove();
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
  });

  function panelOf(container: HTMLElement) {
    return container.firstElementChild as HTMLElement;
  }

  function rowObserver() {
    const found = observers.find((o) => o.observe.mock.calls.some((call) => call[0] === row));
    expect(found, "row ResizeObserver").toBeTruthy();
    return found!;
  }

  function resizeRow(px: number) {
    rowPx = px;
    act(() => {
      rowObserver().cb([], rowObserver() as unknown as ResizeObserver);
    });
  }

  it("shrinks so the document keeps 400px, and a drag cannot take more", () => {
    rowPx = 900;
    const { container } = setup();
    const panel = panelOf(container);
    // Room is 500px; the stored 520px preference is capped to that.
    expect(panel).toHaveStyle({ width: "500px" });
    expect(panel).toHaveAttribute("data-state", "open");
    expect(panel.classList.contains("flex")).toBe(true);
    expect(panel.classList.contains("hidden")).toBe(false);

    const handle = screen.getByTitle("Drag to resize");
    fireEvent.mouseDown(handle, { clientX: 100 });
    // Growing left would want 700px; the row only allows 500.
    fireEvent.mouseMove(window, { clientX: -100 });
    expect(panel).toHaveStyle({ width: "500px" });
    fireEvent.mouseUp(window);
    expect(localStorage.getItem(RIGHT_PANEL_KEY)).toBeNull();

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window);
    expect(panel).toHaveStyle({ width: "400px" });
    expect(localStorage.getItem(RIGHT_PANEL_KEY)).toBe("400");
  });

  it("hides below a 200px panel and returns when the row grows", () => {
    rowPx = 560;
    const { container } = setup();
    const panel = panelOf(container);
    expect(panel).toHaveAttribute("data-state", "closed");
    expect(panel.classList.contains("hidden")).toBe(true);
    // The stored preference is kept while the panel is hidden.
    expect(panel).toHaveStyle({ width: "520px" });

    resizeRow(900);
    expect(panel).toHaveAttribute("data-state", "open");
    expect(panel.classList.contains("flex")).toBe(true);
    expect(panel).toHaveStyle({ width: "500px" });

    // A repeat measurement at the same width stays put.
    resizeRow(900);
    expect(panel).toHaveStyle({ width: "500px" });
  });

  it("hides when the breakpoint is narrow even if the row is wide", () => {
    stubMatchMedia(true);
    rowPx = 1400;
    const { container } = setup();
    const panel = panelOf(container);
    expect(panel).toHaveAttribute("data-state", "closed");
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(panel).toHaveStyle({ width: "520px" });
  });

  it("disconnects the row observer on unmount", () => {
    rowPx = 900;
    const { unmount } = setup();
    const ro = rowObserver();
    expect(ro.observe).toHaveBeenCalledWith(row);
    unmount();
    expect(ro.disconnect).toHaveBeenCalledTimes(1);
  });
});
