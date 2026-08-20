// @vitest-environment jsdom
// PatchNotes reads the bundled patch-notes.md (?raw import) at module scope, so
// its content is deterministic per test run; mock the raw import instead of
// relying on the repo's actual (growing) patch-notes.md.
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIXTURE = `## 2026-07-20
- Added a Stale Dates report
- Lightened colors for better visibility

## 2026-07-01
- Shipped the [Radar](/radar) view
`;

describe("PatchNotes / PatchNoteGroups", () => {
  it("renders the 10 most recent bullets grouped by date, newest first", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: FIXTURE }));
    const { PatchNotes } = await import("./PatchNotes");

    render(<PatchNotes />, { wrapper: wrap() });

    expect(screen.getByRole("heading", { name: "Recent improvements" })).toBeInTheDocument();
    expect(screen.getByText("Added a Stale Dates report")).toBeInTheDocument();
    expect(screen.getByText("Lightened colors for better visibility")).toBeInTheDocument();

    const dates = screen.getAllByRole("time").map((t) => t.textContent);
    expect(dates).toEqual(["Jul 20, 2026", "Jul 1, 2026"]);
  });

  it("renders an in-bullet markdown link using the SPA <Link>, not a full page reload anchor", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: FIXTURE }));
    const { PatchNotes } = await import("./PatchNotes");

    render(<PatchNotes />, { wrapper: wrap() });

    const link = screen.getByText("Radar").closest("a")!;
    expect(link).toHaveAttribute("href", "/radar");
  });

  it("links to the full /updates history page", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: FIXTURE }));
    const { PatchNotes } = await import("./PatchNotes");

    render(<PatchNotes />, { wrapper: wrap() });

    expect(screen.getByRole("link", { name: "View all updates →" })).toHaveAttribute("href", "/updates");
  });

  it("renders nothing when there are no patch note groups", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: "" }));
    const { PatchNotes } = await import("./PatchNotes");

    const { container } = render(<PatchNotes />, { wrapper: wrap() });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an external (non-'/') markdown link as a new-tab anchor", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({
      default: "## 2026-07-01\n- See the [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas) repo\n",
    }));
    const { PatchNotes } = await import("./PatchNotes");

    render(<PatchNotes />, { wrapper: wrap() });

    const link = screen.getByText("next-gen-atlas").closest("a")!;
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/next-gen-atlas");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
