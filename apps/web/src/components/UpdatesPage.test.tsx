// @vitest-environment jsdom
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

function wrap(path = "/updates") {
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

// 11 bullets across 2 groups — exceeds PatchNotes' homepage cap of 10, so this
// also proves UpdatesPage passes Infinity (all 11 render), not the default.
const FIXTURE = `## 2026-07-20
- Bullet one
- Bullet two
- Bullet three
- Bullet four
- Bullet five
- Bullet six
- Bullet seven
- Bullet eight
- Bullet nine
- Bullet ten

## 2026-07-01
- Bullet eleven
`;

describe("UpdatesPage", () => {
  it("sets the document title", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: FIXTURE }));
    const { UpdatesPage } = await import("./UpdatesPage");

    render(<UpdatesPage />, { wrapper: wrap() });
    expect(document.title).toBe("Updates: Sky Atlas by Redline");
  });

  it("renders the full uncapped history, unlike the 10-bullet homepage teaser", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: FIXTURE }));
    const { UpdatesPage } = await import("./UpdatesPage");

    render(<UpdatesPage />, { wrapper: wrap() });

    expect(screen.getByRole("heading", { name: "Updates", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Bullet ten")).toBeInTheDocument();
    expect(screen.getByText("Bullet eleven")).toBeInTheDocument();

    const dates = screen.getAllByRole("time").map((t) => t.textContent);
    expect(dates).toEqual(["Jul 20, 2026", "Jul 1, 2026"]);
  });

  it("renders an empty history gracefully when there are no notes", async () => {
    vi.doMock("../../../../patch-notes.md?raw", () => ({ default: "" }));
    const { UpdatesPage } = await import("./UpdatesPage");

    render(<UpdatesPage />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { name: "Updates", level: 1 })).toBeInTheDocument();
    expect(screen.queryAllByRole("time")).toHaveLength(0);
  });
});
