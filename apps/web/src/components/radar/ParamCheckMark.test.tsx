// @vitest-environment jsdom
// The mark's tooltip says what the check found, line by line: a sentence, a
// labelled value, and when the value was set (linked to its transaction) and
// read. A mark with no document to open is still reachable by keyboard.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { RowMark } from "../../lib/rowMark";
import { ParamCheckMark } from "./ParamCheckMark";
import { MARK_TIP_MS } from "./PauAtlasMark";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mark: RowMark = {
  mark: "mismatch",
  head: "Differs from the atlas",
  docId: "inflow-doc",
  lines: [
    { label: "On-chain", value: "150M USDS" },
    { set: { block: 1, time: "2026-10-14T09:00:00Z", tx: "0xabc" }, chain: "ethereum", readAt: "2026-11-06T09:12:00Z" },
    { label: "Atlas", value: "200,000,000 USDS" },
    { text: "This is the current supply." },
  ],
};

async function hover(el: HTMLElement) {
  vi.useFakeTimers();
  fireEvent.mouseEnter(el);
  await act(async () => { vi.advanceTimersByTime(MARK_TIP_MS + 50); });
}

describe("ParamCheckMark", () => {
  it("shows every line of the check on hover, the set date linked to its transaction", async () => {
    render(<ParamCheckMark mark={mark} />);
    await hover(screen.getByRole("link", { name: "Differs from the atlas" }));
    expect(screen.getByText("150M USDS")).toBeInTheDocument();
    expect(screen.getByText("200,000,000 USDS")).toBeInTheDocument();
    expect(screen.getByText("This is the current supply.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-10-14" })).toHaveAttribute("href", expect.stringContaining("0xabc"));
    expect(screen.getByText(/read 2026-11-06 09:12 UTC/)).toBeInTheDocument();
  });

  it("leaves out the read time when the check has none", async () => {
    render(<ParamCheckMark mark={{ ...mark, lines: [{ set: { block: 1, time: "2026-10-14T09:00:00Z", tx: "0xabc" }, chain: "ethereum", readAt: null }] }} />);
    await hover(screen.getByRole("link", { name: "Differs from the atlas" }));
    expect(screen.queryByText(/read /)).not.toBeInTheDocument();
  });

  it("keeps a mark with no document focusable, and an empty column for a row with no mark", () => {
    const { container } = render(<><ParamCheckMark mark={{ ...mark, mark: "candidate", docId: null }} /><ParamCheckMark mark={null} /></>);
    expect(screen.getByRole("img", { name: "Differs from the atlas" })).toHaveAttribute("tabindex", "0");
    expect(container.querySelectorAll("span.w-4")[1]).toBeEmptyDOMElement();
  });
});
