// @vitest-environment jsdom
// AtlasAnnotations is the resizable right-column wrapper: it owns the panel
// width (persisted in localStorage, clamped to [MIN, MAX], else a default) and
// hosts RightPanel behind an error boundary. useGraphEdges is worker-backed, so
// it's stubbed; RightPanel renders for real. These cases pin the width
// initializer branches (default / valid stored / out-of-range stored) and that
// the panel content mounts.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

  it("mounts the RightPanel tablist inside the wrapper", () => {
    setup();
    expect(screen.getByRole("tab", { name: /notes/ })).toBeInTheDocument();
  });
});
