// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { MistakeRow } from "@/lib/potentialMistakesIndex";
import { EMPTY_QUERY } from "@/lib/reportFilter";
import { PotentialMistakesPager } from "./PotentialMistakesPager";

const row = (over: Partial<MistakeRow> & Pick<MistakeRow, "id" | "quote">): MistakeRow => ({
  docNo: "A.1",
  uuid: "11111111-1111-4111-8111-111111111111",
  file: "A.1.md",
  category: "typo",
  severity: "high",
  pass: "language",
  issue: `issue for ${over.quote}`,
  fix: null,
  status: "current",
  currentDocNo: "A.1",
  title: "Example",
  ...over,
});

const rows: MistakeRow[] = [
  row({ id: "a", quote: "first quote" }),
  row({ id: "b", quote: "second quote" }),
  row({ id: "c", quote: "third quote" }),
];

afterEach(cleanup);

describe("PotentialMistakesPager", () => {
  it("shows one finding at a time and the next button advances", () => {
    render(<PotentialMistakesPager rows={rows} rq={EMPTY_QUERY} />);
    expect(screen.getByText("first quote")).toBeInTheDocument();
    expect(screen.queryByText("second quote")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("A.1")).toBeInTheDocument();
    expect(screen.queryByText("Example")).not.toBeInTheDocument();
    expect(screen.getByText("Typo / spelling").parentElement).toHaveClass("flex");
    expect(screen.getByRole("button", { name: "Previous finding" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next finding" }));
    expect(screen.getByText("second quote")).toBeInTheDocument();
    expect(screen.queryByText("first quote")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("swipes left to the next finding and right to the previous", () => {
    render(<PotentialMistakesPager rows={rows} rq={EMPTY_QUERY} />);
    const card = screen.getByText("first quote").closest("article")!.parentElement!;

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 40, pointerType: "touch" });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 42, pointerType: "touch" });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 42, pointerType: "touch" });
    expect(screen.getByText("second quote")).toBeInTheDocument();

    fireEvent.pointerDown(card, { pointerId: 2, clientX: 80, clientY: 40, pointerType: "touch" });
    fireEvent.pointerMove(card, { pointerId: 2, clientX: 160, clientY: 41, pointerType: "touch" });
    fireEvent.pointerUp(card, { pointerId: 2, clientX: 160, clientY: 41, pointerType: "touch" });
    expect(screen.getByText("first quote")).toBeInTheDocument();
  });

  it("moves with the arrow keys when the pager is focused", () => {
    render(<PotentialMistakesPager rows={rows} rq={EMPTY_QUERY} />);
    const pager = screen.getByRole("region", { name: "Potential mistakes" });
    pager.focus();
    fireEvent.keyDown(pager, { key: "ArrowRight" });
    expect(screen.getByText("second quote")).toBeInTheDocument();
    fireEvent.keyDown(pager, { key: "ArrowLeft" });
    expect(screen.getByText("first quote")).toBeInTheDocument();
  });

  it("ignores a mostly-vertical drag so the page can still scroll", () => {
    render(<PotentialMistakesPager rows={rows} rq={EMPTY_QUERY} />);
    const card = screen.getByText("first quote").closest("article")!.parentElement!;
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100, clientY: 10, pointerType: "touch" });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 110, clientY: 90, pointerType: "touch" });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 110, clientY: 90, pointerType: "touch" });
    expect(screen.getByText("first quote")).toBeInTheDocument();
  });
});
