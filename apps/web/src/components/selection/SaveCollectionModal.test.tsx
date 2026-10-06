// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasNode } from "@/types";

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  activeCollectionId: null as string | null,
  activeCollectionName: null as string | null,
  setActiveCollectionId: vi.fn(),
  setActiveCollectionName: vi.fn(),
  createCollection: vi.fn(),
  updateCollectionItems: vi.fn(),
  getCollection: vi.fn(),
  replace: vi.fn(),
  docs: null as Record<string, AtlasNode> | null,
  stashResumeSave: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../chat/SignInButtons", () => ({
  SignInButtons: ({ onBeforeSignIn }: { onBeforeSignIn?: () => void }) => (
    <button onClick={() => onBeforeSignIn?.()}>mock-sign-in</button>
  ),
}));
vi.mock("../../lib/selection", () => ({
  useSelection: () => ({
    activeCollectionId: mocks.activeCollectionId,
    activeCollectionName: mocks.activeCollectionName,
    setActiveCollectionId: mocks.setActiveCollectionId,
    setActiveCollectionName: mocks.setActiveCollectionName,
    replace: mocks.replace,
  }),
}));
vi.mock("../../hooks/useAtlasData", () => ({ useLoaded: () => mocks.docs }));
vi.mock("../../lib/docs", () => ({ loadDocs: vi.fn() }));
vi.mock("../../lib/collectionsApi", () => ({
  createCollection: mocks.createCollection,
  updateCollectionItems: mocks.updateCollectionItems,
  getCollection: mocks.getCollection,
  MAX_COLLECTION_NAME_LEN: 32,
}));
vi.mock("../../lib/authReturn", () => ({ stashResumeSave: mocks.stashResumeSave }));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));

import { SaveCollectionModal } from "./SaveCollectionModal";

const node = (id: string, doc_no: string, title: string) => ({ id, doc_no, title }) as AtlasNode;
const DOCS = Object.fromEntries(
  ["a", "b", "c", "d"].map((id, i) => [id, node(id, `A.${i + 1}`, `Doc ${id.toUpperCase()}`)]),
);

// An own collection is open and the server holds `saved` for it.
function openOwnCollection(saved: string[]) {
  mocks.user = { id: "u1" };
  mocks.activeCollectionId = "existing1";
  mocks.activeCollectionName = "Existing";
  mocks.docs = DOCS;
  mocks.getCollection.mockResolvedValue({ id: "existing1", name: "Existing", ids: saved, updatedAt: "" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = null;
  mocks.activeCollectionId = null;
  mocks.activeCollectionName = null;
  mocks.docs = null;
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
  it("offers Update, Save as new and Save as new without the opened collection's docs", async () => {
    openOwnCollection(["a"]);
    render(<SaveCollectionModal ids={["a", "b"]} onClose={() => {}} />);
    expect(screen.getByText("Save changes")).toBeInTheDocument();
    expect(screen.getByText("Update “Existing”")).toBeInTheDocument();
    expect(screen.getByText("Save as new collection")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save as new, minus “Existing”" })).toBeEnabled();
  });

  it("Update calls updateCollectionItems + track + onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    openOwnCollection([]);
    mocks.updateCollectionItems.mockResolvedValue({ id: "existing1", name: "Existing" });
    render(<SaveCollectionModal ids={["a", "b"]} onClose={onClose} />);
    await user.click(screen.getByText("Update “Existing”"));
    await waitFor(() => expect(mocks.updateCollectionItems).toHaveBeenCalledWith("existing1", ["a", "b"]));
    expect(mocks.track).toHaveBeenCalledWith("collection_update", { id: "existing1", count: 2 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Save as new collection reveals the naming form with the 'new' heading", async () => {
    const user = userEvent.setup();
    openOwnCollection([]);
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    await user.click(screen.getByText("Save as new collection"));
    expect(screen.getByText("Save as new collection", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Collection name")).toBeInTheDocument();
  });
});

describe("SaveCollectionModal — the documents being saved", () => {
  it("lists the selection's docs in the naming flow", () => {
    mocks.user = { id: "u1" };
    mocks.docs = DOCS;
    render(<SaveCollectionModal ids={["a", "b"]} onClose={() => {}} />);
    expect(screen.getByText("Doc A")).toBeInTheDocument();
    expect(screen.getByText("A.2")).toBeInTheDocument();
  });

  it("truncates past 60 rows with a '+N more' tail while the count still shows the whole selection", () => {
    mocks.user = { id: "u1" };
    const ids = Array.from({ length: 70 }, (_, i) => `d${i}`);
    mocks.docs = Object.fromEntries(ids.map((id, i) => [id, node(id, `B.${i}`, `Title ${i}`)]));
    render(<SaveCollectionModal ids={ids} onClose={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(61);
    expect(screen.getByText("+10 more")).toBeInTheDocument();
    expect(screen.getByText("70 / 8,000 documents")).toBeInTheDocument();
  });

  it("shows no list (just the count) before the docs have loaded", () => {
    mocks.user = { id: "u1" };
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("1 / 8,000 document")).toBeInTheDocument();
  });
});

describe("SaveCollectionModal — comparing with the opened collection", () => {
  it("says how many docs overlap once the saved docs have loaded", async () => {
    openOwnCollection(["a", "b", "x"]);
    render(<SaveCollectionModal ids={["a", "b", "c"]} onClose={() => {}} />);
    expect(screen.getByText("Comparing with “Existing”…")).toBeInTheDocument();
    expect(await screen.findByText("You have made changes since opening “Existing” · 2 docs overlap")).toBeInTheDocument();
    expect(mocks.getCollection).toHaveBeenCalledWith("existing1");
  });

  it("uses the singular for one overlapping doc", async () => {
    openOwnCollection(["a", "x"]);
    render(<SaveCollectionModal ids={["a", "c"]} onClose={() => {}} />);
    expect(await screen.findByText("You have made changes since opening “Existing” · 1 doc overlaps")).toBeInTheDocument();
  });

  it("says there are no changes when the selection equals the saved docs, and disables 'without'", async () => {
    openOwnCollection(["a", "b"]);
    render(<SaveCollectionModal ids={["b", "a"]} onClose={() => {}} />);
    expect(await screen.findByText("No changes since opening “Existing”.")).toBeInTheDocument();
    const without = screen.getByRole("button", { name: /Save as new, minus/ });
    expect(without).toBeDisabled();
    expect(without).toHaveAttribute("title", "Nothing was added beyond “Existing”");
  });

  it("falls back when the saved docs cannot be loaded: Update still works, 'without' is off", async () => {
    const user = userEvent.setup();
    openOwnCollection([]);
    mocks.getCollection.mockRejectedValue(new Error("boom"));
    mocks.updateCollectionItems.mockResolvedValue({});
    render(<SaveCollectionModal ids={["a"]} onClose={() => {}} />);
    expect(await screen.findByText(/Couldn’t load “Existing” to compare/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save as new, minus/ })).toBeDisabled();
    await user.click(screen.getByText("Update “Existing”"));
    await waitFor(() => expect(mocks.updateCollectionItems).toHaveBeenCalledWith("existing1", ["a"]));
  });
});

describe("SaveCollectionModal — previewing each option", () => {
  async function ready() {
    openOwnCollection(["a", "b"]);
    render(<SaveCollectionModal ids={["b", "c", "d"]} onClose={() => {}} />);
    await screen.findByText(/You have made changes/);
  }

  const SUMMARY = "+2 added · −1 removed · 1 unchanged";

  it("Update previews removed and added rows with +/−, with the summary on the count line", async () => {
    await ready();
    fireEvent.mouseEnter(screen.getByText("Update “Existing”"));
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getAllByLabelText("added")).toHaveLength(2);
    expect(screen.getByLabelText("removed")).toBeInTheDocument();
    expect(screen.getByText("Doc A")).toBeInTheDocument(); // removed doc is shown though not in the selection
    // Same line as "N / 8,000 documents", not a paragraph of its own.
    expect(screen.getByText(SUMMARY).closest("p")).toBe(screen.getByText("3 / 8,000 documents").closest("p"));
  });

  it("keeps the preview after the pointer or focus leaves, until another button is hovered", async () => {
    await ready();
    const update = screen.getByText("Update “Existing”");
    fireEvent.mouseEnter(update);
    fireEvent.mouseLeave(update);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getByText("Doc A")).toBeInTheDocument();

    fireEvent.blur(update);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();

    const fresh = screen.getByText("Save as new collection");
    fireEvent.mouseEnter(fresh);
    fireEvent.mouseLeave(fresh);
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByText("Doc A")).toBeNull(); // the plain selection stays
    expect(screen.getByText("Doc B")).toBeInTheDocument();
  });

  it("keyboard focus previews too, and stays on blur", async () => {
    await ready();
    const update = screen.getByText("Update “Existing”");
    fireEvent.focus(update);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    fireEvent.blur(update);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
  });

  it("never adds or removes an element between the heading and the buttons while previewing", async () => {
    await ready();
    const card = screen.getByRole("dialog").firstElementChild as HTMLElement;
    const count = card.children.length;
    const buttons = [screen.getByText("Update “Existing”"), screen.getByText("Save as new collection"), screen.getByRole("button", { name: /Save as new, minus/ })];
    for (const button of buttons) {
      fireEvent.mouseEnter(button);
      expect(card.children.length).toBe(count);
      fireEvent.mouseLeave(button);
      expect(card.children.length).toBe(count);
    }
  });

  it("opens previewing Update, then rings whichever button was last hovered", async () => {
    await ready();
    const update = screen.getByText("Update “Existing”");
    const fresh = screen.getByText("Save as new collection");
    expect(update).toHaveAttribute("data-previewing", "true");
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    fireEvent.mouseEnter(fresh);
    expect(update).not.toHaveAttribute("data-previewing");
    expect(fresh).toHaveAttribute("data-previewing", "true");
    expect(screen.queryByText(SUMMARY)).toBeNull();
    fireEvent.mouseEnter(update);
    expect(update).toHaveAttribute("data-previewing", "true");
  });

  it("starts each preview at the top of the list", async () => {
    await ready();
    fireEvent.mouseEnter(screen.getByText("Update “Existing”"));
    const box = screen.getByText("Doc A").closest("div[style*='overflow']") as HTMLElement;
    box.scrollTop = 50;
    fireEvent.mouseEnter(screen.getByText("Save as new collection"));
    const next = screen.getByText("Doc B").closest("div[style*='overflow']") as HTMLElement;
    expect(next).not.toBe(box);
    expect(next.scrollTop).toBe(0);
  });

  it("'without' previews only the docs added beyond the opened collection", async () => {
    await ready();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Save as new, minus/ }));
    expect(screen.getByText("Doc C")).toBeInTheDocument();
    expect(screen.getByText("Doc D")).toBeInTheDocument();
    expect(screen.queryByText("Doc B")).toBeNull();
  });

  it("'Save as new' previews the whole selection", async () => {
    await ready();
    fireEvent.mouseEnter(screen.getByText("Save as new collection"));
    expect(screen.getByText("Doc B")).toBeInTheDocument();
    expect(screen.getByText("Doc C")).toBeInTheDocument();
    expect(screen.queryByLabelText("added")).toBeNull();
  });
});

describe("SaveCollectionModal — saving as new", () => {
  it("'without' saves only the added docs, then moves the selection and active collection to the new one", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    openOwnCollection(["a", "b"]);
    mocks.createCollection.mockResolvedValue({ id: "new1", name: "Extras" });
    render(<SaveCollectionModal ids={["b", "c", "d"]} onClose={onClose} />);
    await user.click(await screen.findByRole("button", { name: /Save as new, minus/ }));

    expect(screen.getByText("Save as new, minus “Existing”", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("2 / 8,000 documents")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Collection name"), "Extras");
    await user.click(screen.getByText("save"));

    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith("Extras", ["c", "d"]));
    expect(mocks.replace).toHaveBeenCalledWith(["c", "d"]);
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith("new1");
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Extras");
    expect(mocks.track).toHaveBeenCalledWith("collection_save", { count: 2, without_opened: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("plain 'Save as new' saves the whole selection and leaves the selection alone", async () => {
    const user = userEvent.setup();
    openOwnCollection(["a", "b"]);
    mocks.createCollection.mockResolvedValue({ id: "new1", name: "Copy" });
    render(<SaveCollectionModal ids={["b", "c"]} onClose={() => {}} />);
    await user.click(screen.getByText("Save as new collection"));
    await user.type(screen.getByPlaceholderText("Collection name"), "Copy");
    await user.click(screen.getByText("save"));
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledWith("Copy", ["b", "c"]));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith("collection_save", { count: 2 });
  });
});

describe("SaveCollectionModal — list box in the choice view", () => {
  it("is there before the docs have loaded, so loading cannot move the buttons", async () => {
    openOwnCollection(["a"]);
    mocks.docs = null;
    render(<SaveCollectionModal ids={["a", "b"]} onClose={() => {}} />);
    await screen.findByText(/You have made changes/);
    const card = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(card.querySelector("div[style*='overflow']")).not.toBeNull();
  });
});
