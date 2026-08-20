// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionCard } from "./CollectionCard";
import type { Collection } from "@/lib/collectionsApi";
import type { AtlasNode } from "@/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}

function collection(over: Partial<Collection> = {}): Collection {
  return { id: "c1", name: "My Collection", ids: ["a", "b", "c"], updatedAt: "2026-01-15T00:00:00.000Z", ...over };
}

describe("CollectionCard", () => {
  it("renders name, doc count, and doc list from the docs map", () => {
    const docs = { a: node("a", "A.1", "Alpha"), b: node("b", "A.2", "Beta"), c: node("c", "A.3", "Gamma") };
    render(
      <CollectionCard collection={collection()} docs={docs} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByText("My Collection")).toBeInTheDocument();
    expect(screen.getByText("3 documents")).toBeInTheDocument();
    expect(screen.getByText("A.1")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("shows singular 'document' for a single-item collection", () => {
    render(
      <CollectionCard
        collection={collection({ ids: ["a"] })}
        docs={null}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("1 document")).toBeInTheDocument();
  });

  it("renders no preview list when docs is null", () => {
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByText("A.1")).not.toBeInTheDocument();
  });

  it("shows a '+N more' row when the collection has more docs than the preview count", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
    const docs: Record<string, AtlasNode> = {};
    ids.forEach((id, i) => { docs[id] = node(id, `A.${i}`, `Doc ${i}`); });
    render(
      <CollectionCard
        collection={collection({ ids })}
        docs={docs}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("filters out ids missing from the docs map", () => {
    const docs = { a: node("a", "A.1", "Alpha") };
    render(
      <CollectionCard
        collection={collection({ ids: ["a", "missing"] })}
        docs={docs}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  // C5: an unbroken 200-char name (API-creatable pre-fix, or grandfathered
  // from before the server cap was lowered) must never blow out the card /
  // page width — the name column needs the same truncate/min-w-0 treatment
  // the doc-title rows already use, and the date column must hold its size.
  it("C5: a long unbroken name gets truncate/min-w-0 treatment; the date column doesn't shrink", () => {
    const longName = "x".repeat(200);
    const { container } = render(
      <CollectionCard
        collection={collection({ name: longName })}
        docs={null}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    const nameButton = screen.getByText(longName);
    expect(nameButton.tagName).toBe("BUTTON");
    expect(nameButton.className).toContain("truncate");
    expect(nameButton.className).toContain("min-w-0");
    // CSS-only truncation — the full name is still in the DOM (assistive tech
    // and copy/paste still see it), only its rendered box is clipped.
    expect(nameButton.textContent).toBe(longName);

    expect(nameButton.parentElement?.className).toContain("min-w-0");
    const dateEl = container.querySelector("p.whitespace-nowrap");
    expect(dateEl?.className).toContain("shrink-0");
  });

  it("calls onOpen when Open is clicked", () => {
    const onOpen = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={onOpen} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("calls onDelete when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={() => {}} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("renaming: clicking the name reveals an input, and Enter commits a changed value", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("My Collection"));
    const input = screen.getByDisplayValue("My Collection");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    expect(onRename).toHaveBeenCalledWith("New Name");
  });

  it("renaming: the Rename button also opens the input", async () => {
    const user = userEvent.setup();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("Rename"));
    expect(screen.getByDisplayValue("My Collection")).toBeInTheDocument();
  });

  it("renaming: Escape reverts the draft and does not call onRename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("My Collection"));
    const input = screen.getByDisplayValue("My Collection");
    await user.type(input, " extra{Escape}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("My Collection")).toBeInTheDocument();
  });

  it("renaming: blurring with an unchanged (whitespace-only) value does not call onRename", () => {
    const onRename = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("My Collection"));
    const input = screen.getByDisplayValue("My Collection");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("My Collection")).toBeInTheDocument();
  });

  it("renaming: blurring with a real change commits via onRename", () => {
    const onRename = vi.fn();
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("My Collection"));
    const input = screen.getByDisplayValue("My Collection");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("Renamed");
  });

  it("share: copies the link to the clipboard and shows 'Copied!'", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("Share"));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/c/c1`);
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("share: falls back to window.prompt when clipboard write fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("nope")) } });
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => null);
    render(
      <CollectionCard collection={collection()} docs={null} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("Share"));
    expect(await screen.findByText("Share")).toBeInTheDocument();
    expect(promptSpy).toHaveBeenCalledWith("Copy this share link:", `${window.location.origin}/c/c1`);
  });
});
