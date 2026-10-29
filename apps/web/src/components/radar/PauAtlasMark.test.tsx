// @vitest-environment jsdom
// The Atlas column's mark: the verdict linked to its document, a ? linked to
// the document naming the key, else the flag it is given (pauAtlasFlag.ts);
// each explains itself in a tooltip after the pointer rests on it.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { MARK_TIP_MS, PauAtlasMark } from "./PauAtlasMark";

const spell = { kind: "spell" as const, text: "No Atlas document found for this limit, set by a spell on 2026-10-12." };

describe("PauAtlasMark", () => {
  it("shows the flag it is given where no document is connected, and nothing without one", () => {
    const { container } = render(<PauAtlasMark flag={spell} />);
    expect(within(container).getByRole("img", { name: spell.text })).toHaveAttribute("data-atlas-flag", "spell");
    const none = render(<PauAtlasMark flag={null} />);
    expect(none.container).toBeEmptyDOMElement();
  });
  it("shows the verdict mark, not the flag, where a document is connected", () => {
    const { container } = render(<PauAtlasMark flag={spell} verdict={{ mark: "mismatch", docId: "doc-1" }} />);
    expect(within(container).getByRole("link", { name: /^differs from the atlas/ })).toHaveAttribute("href", "/atlas?id=doc-1&view=onchain");
    expect(container.querySelector("[data-atlas-flag]")).toBeNull();
  });
  it("shows a ? linked to the document naming the key where none states a value, never the flag", () => {
    const { container } = render(<PauAtlasMark flag={spell} keyDocId="key-doc" />);
    const link = within(container).getByRole("link", { name: /names this limit's key/ });
    expect([link.textContent, link.getAttribute("href")]).toEqual(["?", "/atlas?id=key-doc&view=onchain"]);
    expect(container.querySelector("[data-atlas-flag]")).toBeNull();
  });
  it("says where the Atlas does state a value for a key it states nothing for on this contract", () => {
    const { container } = render(<PauAtlasMark keyDocId="key-doc" verdict={{ mark: "elsewhere", docId: "value-doc", on: ["arbitrum diamond"] }} />);
    const link = within(container).getByRole("link", { name: /only for the Arbitrum Diamond PAU, not for this contract/ });
    expect([link.textContent, link.getAttribute("href")]).toEqual(["?", "/atlas?id=value-doc&view=onchain"]);
  });
  it("opens the mark's tooltip only once the pointer has rested on it for 600ms", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<PauAtlasMark verdict={{ mark: "mismatch", docId: "doc-1" }} />);
      const mark = within(container).getByRole("link", { name: /^differs from the atlas/ });
      expect(mark).not.toHaveAttribute("title");
      fireEvent.mouseEnter(mark);
      act(() => vi.advanceTimersByTime(MARK_TIP_MS - 1));
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("tooltip")).toHaveTextContent(/^differs from the atlas/);
      expect(MARK_TIP_MS).toBe(600);
    } finally {
      vi.useRealTimers();
    }
  });
});
