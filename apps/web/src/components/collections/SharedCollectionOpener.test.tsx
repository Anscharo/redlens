// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  setActiveCollectionId: vi.fn(),
  setActiveCollectionName: vi.fn(),
  navigate: vi.fn(),
  track: vi.fn(),
  getSharedCollection: vi.fn(),
  getSharedConversationCollection: vi.fn(),
}));

vi.mock("../../lib/selection", () => ({
  useSelection: () => ({
    replace: mocks.replace,
    setActiveCollectionId: mocks.setActiveCollectionId,
    setActiveCollectionName: mocks.setActiveCollectionName,
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/c/abc", mocks.navigate],
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));
vi.mock("../../lib/collectionsApi", () => ({ getSharedCollection: mocks.getSharedCollection }));
vi.mock("../../lib/conversationsApi", () => ({ getSharedConversationCollection: mocks.getSharedConversationCollection }));

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
    // P1 (PR #230): a shared collection must clear any stale own-collection id,
    // else the save modal would PATCH the viewer's previous collection.
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith(null);
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

  it("falls back to a conversation's collection when the id is not a saved collection", async () => {
    mocks.getSharedCollection.mockRejectedValue(new Error("404"));
    mocks.getSharedConversationCollection.mockResolvedValue({ id: "abc", name: "Spark rates", ids: ["x", "y", "z"], auto: true });
    render(<SharedCollectionOpener id="abc" />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.getSharedConversationCollection).toHaveBeenCalledWith("abc");
    expect(mocks.replace).toHaveBeenCalledWith(["x", "y", "z"]);
    // Same rule as a saved shared collection: never the viewer's to overwrite.
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith(null);
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Spark rates");
    expect(mocks.navigate).toHaveBeenCalledWith("/atlas?subset=selected", { replace: true });
  });

  it("does not ask for a conversation when the saved collection is found", async () => {
    mocks.getSharedCollection.mockResolvedValue({ id: "abc", name: "Shared", ids: ["x"], updatedAt: "" });
    render(<SharedCollectionOpener id="abc" />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.getSharedConversationCollection).not.toHaveBeenCalled();
  });

  it("on failure: shows an error and a link back to the atlas", async () => {
    mocks.getSharedCollection.mockRejectedValue(new Error("404"));
    mocks.getSharedConversationCollection.mockRejectedValue(new Error("404"));
    render(<SharedCollectionOpener id="missing" />);
    expect(await screen.findByText("This shared collection could not be found.")).toBeInTheDocument();
    expect(screen.getByText("← back to the atlas")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
