// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CollectionBlurb } from "./CollectionBlurb";

const mocks = vi.hoisted(() => ({ getCollectionSummary: vi.fn() }));
vi.mock("../../lib/collectionsApi", () => ({ getCollectionSummary: mocks.getCollectionSummary }));

afterEach(() => {
  cleanup();
  mocks.getCollectionSummary.mockReset();
});

describe("CollectionBlurb", () => {
  it("shows the group name and summary once they load", async () => {
    mocks.getCollectionSummary.mockResolvedValue({ label: "Rate limits", summary: "Limits per agent." });
    const { container } = render(<CollectionBlurb id="c1" updatedAt="t1" />);
    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByText("Rate limits")).toBeInTheDocument();
    expect(screen.getByText(/Limits per agent\./)).toBeInTheDocument();
    expect(mocks.getCollectionSummary).toHaveBeenCalledWith("c1");
  });

  it("shows nothing when none could be written", async () => {
    mocks.getCollectionSummary.mockResolvedValue({ label: null, summary: null });
    const { container } = render(<CollectionBlurb id="c1" updatedAt="t1" />);
    await waitFor(() => expect(mocks.getCollectionSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the read fails", async () => {
    mocks.getCollectionSummary.mockRejectedValue(new Error("boom"));
    const { container } = render(<CollectionBlurb id="c1" updatedAt="t1" />);
    await waitFor(() => expect(mocks.getCollectionSummary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the old text and reads again when the collection changes", async () => {
    mocks.getCollectionSummary.mockResolvedValueOnce({ label: "Old", summary: "Old text." });
    const { rerender } = render(<CollectionBlurb id="c1" updatedAt="t1" />);
    await screen.findByText("Old");
    mocks.getCollectionSummary.mockResolvedValueOnce({ label: "New", summary: "New text." });
    rerender(<CollectionBlurb id="c1" updatedAt="t2" />);
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(mocks.getCollectionSummary).toHaveBeenCalledTimes(2);
  });

  it("ignores an answer that arrives after it unmounted", async () => {
    let resolve!: (v: { label: string; summary: string }) => void;
    mocks.getCollectionSummary.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = render(<CollectionBlurb id="c1" updatedAt="t1" />);
    unmount();
    resolve({ label: "Late", summary: "Late." });
    await Promise.resolve();
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
  });
});
