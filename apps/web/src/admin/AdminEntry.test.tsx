// @vitest-environment jsdom
// The color picker modal itself isn't mounted on any of these routes (it only
// renders once a swatch is clicked), so this exercises the real PalettePage
// tree — including importing ColorPickerModal and @uiw/react-color — without
// needing to stub the picker widgets.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AdminEntry } from "./AdminEntry";

afterEach(() => cleanup());

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <AdminEntry />
    </Router>,
  );
}

describe("AdminEntry routing", () => {
  it("renders the Palette page at /admin/palette", () => {
    renderAt("/admin/palette");
    expect(screen.getByRole("heading", { level: 1, name: "Palette" })).toBeInTheDocument();
  });

  it("renders the Tools page at /admin", () => {
    renderAt("/admin");
    expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
  });

  it("falls back to a not-found message for an unmatched admin route", () => {
    renderAt("/admin/nope");
    expect(screen.getByText("admin: not found")).toBeInTheDocument();
  });

  it("sets the document title while mounted and restores it on unmount", () => {
    const { unmount } = renderAt("/admin");
    expect(document.title).toBe("Admin: Sky Atlas by Redline");
    unmount();
    expect(document.title).toBe("Sky Atlas by Redline");
  });
});
