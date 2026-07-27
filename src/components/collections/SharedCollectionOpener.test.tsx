// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  setActiveCollectionName: vi.fn(),
  navigate: vi.fn(),
  track: vi.fn(),
  getSharedCollection: vi.fn(),
}));

vi.mock("../../lib/selection", () => ({
  useSelection: () => ({ replace: mocks.replace, setActiveCollectionName: mocks.setActiveCollectionName }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/c/abc", mocks.navigate],
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));
vi.mock("../../lib/collectionsApi", () => ({ getSharedCollection: mocks.getSharedCollection }));

import { SharedCollectionOpener } from "./SharedCollectionOpener";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SharedCollectionOpener", () => {
  it("shows the opening state initially", () => {
    mocks.getSharedCollection.mockReturnValue(new Promise(() => {}));
    render(<SharedCollectionOpener id="abc" />);
    expect(screen.getByText("Opening shared collection…")).toBeInTheDocument();
  });

  it("on success: loads the collection into selection, tracks, and navigates to the reader", async () => {
    mocks.getSharedCollection.mockResolvedValue({ id: "abc", name: "Shared", ids: ["x", "y"], updatedAt: "" });
    render(<SharedCollectionOpener id="abc" />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.getSharedCollection).toHaveBeenCalledWith("abc");
    expect(mocks.replace).toHaveBeenCalledWith(["x", "y"]);
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Shared");
    expect(mocks.track).toHaveBeenCalledWith("collection_open_shared", { id: "abc", count: 2 });
    expect(mocks.navigate).toHaveBeenCalledWith("/atlas?subset=selected", { replace: true });
  });

  it("ignores a resolution that arrives after unmount", async () => {
    let resolve!: (c: { id: string; name: string; ids: string[]; updatedAt: string }) => void;
    mocks.getSharedCollection.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<SharedCollectionOpener id="abc" />);
    unmount();
    resolve({ id: "abc", name: "Shared", ids: ["x"], updatedAt: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("on failure: shows an error and a link back to the atlas", async () => {
    mocks.getSharedCollection.mockRejectedValue(new Error("404"));
    render(<SharedCollectionOpener id="missing" />);
    expect(await screen.findByText("This shared collection could not be found.")).toBeInTheDocument();
    expect(screen.getByText("← back to the atlas")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
