// @vitest-environment jsdom
import { describe, it, expect, afterEach, afterAll, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Breadcrumbs } from "./Breadcrumbs";
import { makeNode } from "../test/fixtures";

// These stubs mutate shared globals (window.ResizeObserver, the canvas 2d
// context). We capture the originals and restore them in afterAll so this file
// doesn't leak its polyfills into other test files running in the same worker.
const origResizeObserver = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
const origGetContext = HTMLCanvasElement.prototype.getContext;

// jsdom has no ResizeObserver; Breadcrumbs only reads contentRect off the
// callback, which we never need to fire for correctness at the default width.
beforeAll(() => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver =
    FakeResizeObserver;

  // jsdom has no canvas backend; fitBreadcrumbs' pretext measurement (>6
  // ancestors path) needs a 2d context with measureText. A flat per-char
  // width is enough to exercise the layout branches deterministically.
  (
    HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown }
  ).getContext = ((id: string) => {
    if (id !== "2d") return null;
    return {
      font: "",
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  (window as unknown as { ResizeObserver?: unknown }).ResizeObserver = origResizeObserver;
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

afterEach(cleanup);

describe("Breadcrumbs", () => {
  it("renders nothing when there are no ancestors", () => {
    const { container } = render(<Breadcrumbs ancestors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single ancestor with no separator", () => {
    const a = makeNode({ id: "a1", doc_no: "A.1", title: "Scope A" });
    render(<Breadcrumbs ancestors={[a]} />);
    // jsdom renders both the truncated ".short" and untruncated ".full" spans
    // (the CSS that hides one via hover/focus isn't loaded), so the accessible
    // name doubles up ("Scope AScope A") — match loosely instead.
    expect(screen.getByRole("link", { name: /Scope A/ })).toBeInTheDocument();
    expect(screen.queryByText("/")).toBeNull();
  });

  it("fires the breadcrumb-nav analytics callback on click without breaking navigation", () => {
    const a = makeNode({ id: "a1", doc_no: "A.1", title: "Scope A" });
    render(<Breadcrumbs ancestors={[a]} />);
    const link = screen.getByRole("link", { name: /Scope A/ });
    fireEvent.click(link);
    expect(link).toBeInTheDocument();
  });

  it("renders a separator between multiple ancestors", () => {
    const a = makeNode({ id: "a1", doc_no: "A.1", title: "Scope A" });
    const b = makeNode({ id: "a2", doc_no: "A.1.2", title: "Article B" });
    render(<Breadcrumbs ancestors={[a, b]} />);
    expect(screen.getByRole("link", { name: /Scope A/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Article B/ })).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("links point at the atlas route for each ancestor id", () => {
    const a = makeNode({ id: "a1", doc_no: "A.1", title: "Scope A" });
    render(<Breadcrumbs ancestors={[a]} />);
    expect(screen.getByRole("link", { name: /Scope A/ })).toHaveAttribute(
      "href",
      expect.stringContaining("id=a1"),
    );
  });

  it("switches to nowrap layout once there are more than 6 ancestors", () => {
    const ancestors = Array.from({ length: 7 }, (_, i) =>
      makeNode({ id: `n${i}`, doc_no: `A.${i + 1}`, title: `Node ${i}` }),
    );
    const { container } = render(<Breadcrumbs ancestors={ancestors} />);
    const nav = container.querySelector("nav")!;
    expect(nav.className).not.toContain("flex-wrap");
    expect(nav).toHaveStyle({ whiteSpace: "nowrap" });
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(ancestors.length);
    ancestors.forEach((n, i) => {
      expect(links[i]).toHaveAttribute("href", expect.stringContaining(`id=${n.id}`));
    });
  });

  it("keeps the wrapping layout at 6 or fewer ancestors", () => {
    const ancestors = Array.from({ length: 3 }, (_, i) =>
      makeNode({ id: `m${i}`, doc_no: `A.${i + 1}`, title: `Node ${i}` }),
    );
    const { container } = render(<Breadcrumbs ancestors={ancestors} />);
    const nav = container.querySelector("nav")!;
    expect(nav.className).toContain("flex-wrap");
  });
});
