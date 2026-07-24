// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchResult } from "./SearchResult";
import { makeSearchHit } from "../test/fixtures";

afterEach(cleanup);

function setup(overrides: Parameters<typeof makeSearchHit>[0] = {}, rank = 0) {
  const onResultClick = vi.fn();
  const hit = makeSearchHit(overrides);
  const utils = render(<SearchResult hit={hit} rank={rank} onResultClick={onResultClick} />);
  return { ...utils, hit, onResultClick };
}

describe("SearchResult", () => {
  it("renders title, type, doc_no and id, and the snippet markup", () => {
    const { container } = setup({
      title: "Delegated Signers",
      titleHtml: "Delegated <mark>Signers</mark>",
      type: "Core",
      doc_no: "A.1.2",
      snippet: "a <mark>match</mark> here",
    });
    expect(screen.getByRole("heading", { level: 3 }).innerHTML).toBe("Delegated <mark>Signers</mark>");
    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.getByText("A.1.2")).toBeTruthy();
    expect(container.querySelector("p")?.innerHTML).toBe("a <mark>match</mark> here");
  });

  it("does not render a snippet paragraph when snippet is empty", () => {
    const { container } = setup({ snippet: "" });
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows the match reason (not-via-chainlog branch)", () => {
    setup({ matchReason: "title + content" });
    expect(screen.getByText("matched")).toBeTruthy();
    expect(screen.getByText("title + content")).toBeTruthy();
  });

  it("shows chainlog id + shortened address instead of the match reason when chainlogId is set", () => {
    // Note: when hit.chainlogId is set, the component computes a stripped
    // `reason` (matchReason with "chainlog + " removed) but never renders it —
    // the chainlog branch only shows chainlogId + shortAddress. Asserting the
    // actually-visible output here, not the unused `reason` value.
    setup({
      chainlogId: "MCD_VAT",
      chainlogAddress: "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B",
      matchReason: "chainlog + title",
    });
    expect(screen.getByText("via chainlog")).toBeTruthy();
    expect(screen.getByText("MCD_VAT")).toBeTruthy();
    expect(screen.queryByText("matched")).toBeNull();
  });

  it("renders no gutter labels when hit.labels is absent", () => {
    const { container } = setup({ labels: undefined });
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("renders scope/agent/icd gutter labels with the right tag prefixes", () => {
    setup({
      labels: [
        { kind: "scope", text: "Accessibility Scope" },
        { kind: "agent", text: "Keel" },
        { kind: "icd", text: "ICD-42" },
      ],
    });
    // scope has no tag prefix
    expect(screen.getByTitle("Accessibility Scope")).toBeTruthy();
    // agent/icd get a "KIND: text" title
    expect(screen.getByTitle("AGENT: Keel")).toBeTruthy();
    expect(screen.getByTitle("ICD: ICD-42")).toBeTruthy();
    expect(screen.getByText("AGENT")).toBeTruthy();
    expect(screen.getByText("ICD")).toBeTruthy();
  });

  it("calls onResultClick with the hit and rank when the result link is clicked", () => {
    const { hit, onResultClick } = setup({}, 3);
    fireEvent.click(screen.getByRole("link"));
    expect(onResultClick).toHaveBeenCalledWith(hit, 3);
  });

  it("links to the atlas href for the hit id", () => {
    setup({ id: "00000000-0000-4000-8000-000000000042" });
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/atlas?id=00000000-0000-4000-8000-000000000042",
    );
  });
});
