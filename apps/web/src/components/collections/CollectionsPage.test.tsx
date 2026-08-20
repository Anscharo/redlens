// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CollectionsPage } from "./CollectionsPage";
import type { Collection } from "../../lib/collectionsApi";

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  collections: [] as Collection[],
  loading: false,
  error: null as string | null,
  rename: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  replace: vi.fn(),
  setActiveCollectionId: vi.fn(),
  setActiveCollectionName: vi.fn(),
  navigate: vi.fn(),
  track: vi.fn(),
  loadDocs: vi.fn().mockResolvedValue({}),
}));

vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../chat/SignInButtons", () => ({
  SignInButtons: () => <div data-testid="signin-buttons" />,
}));
vi.mock("../../hooks/useCollections", () => ({
  useCollections: () => ({
    collections: mocks.collections,
    loading: mocks.loading,
    error: mocks.error,
    rename: mocks.rename,
    remove: mocks.remove,
  }),
}));
vi.mock("../../lib/selection", () => ({
  useSelection: () => ({
    replace: mocks.replace,
    setActiveCollectionId: mocks.setActiveCollectionId,
    setActiveCollectionName: mocks.setActiveCollectionName,
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/collections", mocks.navigate] }));
vi.mock("../../lib/docs", () => ({ loadDocs: mocks.loadDocs }));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = null;
  mocks.collections = [];
  mocks.loading = false;
  mocks.error = null;
});

describe("CollectionsPage — signed out", () => {
  it("shows a sign-in prompt and never loads docs", () => {
    render(<CollectionsPage />);
    expect(screen.getByText("Sign in to view your collections")).toBeInTheDocument();
    expect(screen.getByTestId("signin-buttons")).toBeInTheDocument();
    expect(mocks.loadDocs).not.toHaveBeenCalled();
  });
});

describe("CollectionsPage — signed in", () => {
  it("shows a loading state", () => {
    mocks.user = { id: "u1" };
    mocks.loading = true;
    render(<CollectionsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    mocks.user = { id: "u1" };
    mocks.error = "boom";
    render(<CollectionsPage />);
    expect(screen.getByText("Failed to load collections: boom")).toBeInTheDocument();
  });

  it("shows an empty state when there are no collections", () => {
    mocks.user = { id: "u1" };
    render(<CollectionsPage />);
    expect(screen.getByText(/No collections yet/)).toBeInTheDocument();
  });

  it("loads docs on mount when signed in", async () => {
    mocks.user = { id: "u1" };
    render(<CollectionsPage />);
    await waitFor(() => expect(mocks.loadDocs).toHaveBeenCalled());
  });

  it("tolerates a failed docs load (falls back to a bare count)", async () => {
    mocks.user = { id: "u1" };
    mocks.loadDocs.mockRejectedValueOnce(new Error("network"));
    mocks.collections = [{ id: "c1", name: "Mine", ids: ["a"], updatedAt: "2026-01-01T00:00:00.000Z" }];
    render(<CollectionsPage />);
    await waitFor(() => expect(mocks.loadDocs).toHaveBeenCalled());
    expect(await screen.findByText("1 document")).toBeInTheDocument();
  });

  it("renders a CollectionCard per collection and wires Open → replace + navigate + track", () => {
    mocks.user = { id: "u1" };
    mocks.collections = [{ id: "c1", name: "Mine", ids: ["a", "b"], updatedAt: "2026-01-01T00:00:00.000Z" }];
    render(<CollectionsPage />);
    expect(screen.getByText("Mine")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open"));
    expect(mocks.replace).toHaveBeenCalledWith(["a", "b"]);
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith("c1");
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Mine");
    expect(mocks.track).toHaveBeenCalledWith("collection_open", { id: "c1", count: 2 });
    expect(mocks.navigate).toHaveBeenCalledWith("/atlas?subset=selected");
  });

  // C4: opening an EMPTY collection must still set the active id/name (not
  // skip them) — SelectionProvider's empties-effect is what's responsible for
  // not wiping them back out again; see selection.test.tsx. This test pins
  // openCollection's side of that contract: it must keep calling
  // replace([]) + setActiveCollectionId + setActiveCollectionName + navigate
  // exactly as it does for a non-empty collection, with nothing skipped or
  // special-cased for the empty-ids case.
  it("Open on an empty collection still sets replace([]) + active id/name + navigates", () => {
    mocks.user = { id: "u1" };
    mocks.collections = [{ id: "c1", name: "Empty", ids: [], updatedAt: "2026-01-01T00:00:00.000Z" }];
    render(<CollectionsPage />);
    fireEvent.click(screen.getByText("Open"));
    expect(mocks.replace).toHaveBeenCalledWith([]);
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith("c1");
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Empty");
    expect(mocks.track).toHaveBeenCalledWith("collection_open", { id: "c1", count: 0 });
    expect(mocks.navigate).toHaveBeenCalledWith("/atlas?subset=selected");
  });

  it("Delete: confirms, then calls remove + track", async () => {
    mocks.user = { id: "u1" };
    mocks.collections = [{ id: "c1", name: "Mine", ids: ["a"], updatedAt: "2026-01-01T00:00:00.000Z" }];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CollectionsPage />);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("c1"));
    expect(mocks.track).toHaveBeenCalledWith("collection_delete", { id: "c1" });
  });

  it("Delete: cancelling the confirm dialog skips remove", () => {
    mocks.user = { id: "u1" };
    mocks.collections = [{ id: "c1", name: "Mine", ids: ["a"], updatedAt: "2026-01-01T00:00:00.000Z" }];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CollectionsPage />);
    fireEvent.click(screen.getByText("Delete"));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("Rename: wires through to the rename() hook function", () => {
    mocks.user = { id: "u1" };
    mocks.collections = [{ id: "c1", name: "Mine", ids: ["a"], updatedAt: "2026-01-01T00:00:00.000Z" }];
    render(<CollectionsPage />);
    fireEvent.click(screen.getByText("Mine"));
    const input = screen.getByDisplayValue("Mine");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(mocks.rename).toHaveBeenCalledWith("c1", "Renamed");
  });
});
