// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  activeCollectionId: null as string | null,
  activeCollectionName: null as string | null,
  setActiveCollectionId: vi.fn(),
  setActiveCollectionName: vi.fn(),
  createCollection: vi.fn(),
  updateCollectionItems: vi.fn(),
  stashResumeSave: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../chat/SignInButtons", () => ({
  SignInButtons: ({ onBeforeSignIn }: { onBeforeSignIn?: () => void }) => (
    <button onClick={() => onBeforeSignIn?.()}>mock-sign-in</button>
  ),
}));
vi.mock("@/lib/selection", () => ({
  useSelection: () => ({
    activeCollectionId: mocks.activeCollectionId,
    activeCollectionName: mocks.activeCollectionName,
    setActiveCollectionId: mocks.setActiveCollectionId,
    setActiveCollectionName: mocks.setActiveCollectionName,
  }),
}));
vi.mock("@/lib/collectionsApi", () => ({
  createCollection: mocks.createCollection,
  updateCollectionItems: mocks.updateCollectionItems,
  MAX_COLLECTION_NAME_LEN: 32,
}));
vi.mock("@/lib/authReturn", () => ({ stashResumeSave: mocks.stashResumeSave }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));

import { SaveCollectionModal } from "./SaveCollectionModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = null;
  mocks.activeCollectionId = null;
  mocks.activeCollectionName = null;
});

describe("SaveCollectionModal — signed out", () => {
  it("shows sign-in and stashes resume-save intent before signing in", async () => {
    const user = userEvent.setup();
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    expect(screen.getByText("Sign in to save this selection as a collection")).toBeInTheDocument();
    await user.click(screen.getByText("mock-sign-in"));
    expect(mocks.stashResumeSave).toHaveBeenCalled();
  });
});

describe("SaveCollectionModal — signed in, no active collection", () => {
  it("goes straight to the naming form and shows the doc count", () => {
    mocks.user = { id: "u1" };
    render(<SaveCollectionModal ids={["a", "b"]} onClose={() => {}} />);
    expect(screen.getByText("Save as collection")).toBeInTheDocument();
    expect(screen.getByText("2 / 8,000 documents")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Collection name")).toBeInTheDocument();
  });

  it("disables Save until a name is entered, then creates + tracks + closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.user = { id: "u1" };
    mocks.createCollection.mockResolvedValue({ id: "new1", name: "Trip" });
    render(<SaveCollectionModal ids={["a", "b"]} onClose={onClose} />);

    const saveBtn = screen.getByText("save");
    expect(saveBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Collection name"), "Trip");
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith("Trip", ["a", "b"]));
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith("new1");
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Trip");
    expect(mocks.track).toHaveBeenCalledWith("collection_save", { count: 2 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Enter in the name input triggers create", async () => {
    mocks.user = { id: "u1" };
    mocks.createCollection.mockResolvedValue({ id: "new1", name: "Trip" });
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Collection name");
    fireEvent.change(input, { target: { value: "Trip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith("Trip", ["a"]));
  });

  it("shows an error message and re-enables Save when create fails", async () => {
    const user = userEvent.setup();
    mocks.user = { id: "u1" };
    mocks.createCollection.mockRejectedValue(new Error("server exploded"));
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText("Collection name"), "Trip");
    await user.click(screen.getByText("save"));
    expect(await screen.findByText("server exploded")).toBeInTheDocument();
    expect(screen.getByText("save")).not.toBeDisabled();
  });

  it("cancel calls onClose without saving", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.user = { id: "u1" };
    render(<SaveCollectionModal ids={["a"]} onClose={onClose} />);
    await user.click(screen.getByText("cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.createCollection).not.toHaveBeenCalled();
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    mocks.user = { id: "u1" };
    render(<SaveCollectionModal ids={["a"]} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop calls onClose, but clicking inside the panel does not", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.user = { id: "u1" };
    render(<SaveCollectionModal ids={["a"]} onClose={onClose} />);
    await user.click(screen.getByText("Save as collection"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an over-the-limit warning and disables Save when ids exceed the max", () => {
    mocks.user = { id: "u1" };
    const ids = Array.from({ length: 8001 }, (_, i) => `id${i}`);
    render(<SaveCollectionModal ids={ids} onClose={() => {}} />);
    expect(screen.getByText(/over the limit/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Collection name"), { target: { value: "Big" } });
    expect(screen.getByText("save")).toBeDisabled();
  });
});

describe("SaveCollectionModal — signed in, with an active collection", () => {
  it("offers Update vs Save-as-new first", () => {
    mocks.user = { id: "u1" };
    mocks.activeCollectionId = "existing1";
    mocks.activeCollectionName = "Existing";
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    expect(screen.getByText("Save changes")).toBeInTheDocument();
    expect(screen.getByText("Update “Existing”")).toBeInTheDocument();
    expect(screen.getByText("Save as new collection")).toBeInTheDocument();
  });

  it("Update calls updateCollectionItems + track + onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.user = { id: "u1" };
    mocks.activeCollectionId = "existing1";
    mocks.activeCollectionName = "Existing";
    mocks.updateCollectionItems.mockResolvedValue({ id: "existing1", name: "Existing" });
    render(<SaveCollectionModal ids={["a", "b"]} onClose={onClose} />);
    await user.click(screen.getByText("Update “Existing”"));
    await waitFor(() => expect(mocks.updateCollectionItems).toHaveBeenCalledWith("existing1", ["a", "b"]));
    expect(mocks.track).toHaveBeenCalledWith("collection_update", { id: "existing1", count: 2 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Save as new collection reveals the naming form with the 'new' heading", async () => {
    const user = userEvent.setup();
    mocks.user = { id: "u1" };
    mocks.activeCollectionId = "existing1";
    mocks.activeCollectionName = "Existing";
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    await user.click(screen.getByText("Save as new collection"));
    expect(screen.getByText("Save as new collection", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Collection name")).toBeInTheDocument();
  });
});
