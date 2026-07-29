// @vitest-environment jsdom
// EntryRow is one node on the history timeline: line 1 (date + PR/commit/source)
// is the entry's heading and the line the timeline dot centers on, line 2 the
// change title, line 3 the type of edit. These pin the per-branch content rules —
// what each entry shape shows, and just as importantly what it no longer shows.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EntryRow } from "./EntryRow";
import { LINE1_H } from "./Timeline";
import type { HistoryEntry } from "../../lib/history";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { date: "2025-01-01", commitHash: "abc1234", changeType: "modified", ...over };
}

afterEach(cleanup);

describe("EntryRow line 1", () => {
  it("renders the date as a <time> and the PR as a linked 'PR n'", () => {
    render(
      <EntryRow
        entry={entry({ pr: 236, prUrl: "https://github.com/sky-ecosystem/next-gen-atlas/pull/236" })}
      />,
    );
    const date = screen.getByText("2025-01-01");
    expect(date.tagName).toBe("TIME");
    expect(date).toHaveAttribute("datetime", "2025-01-01");
    expect(screen.getByRole("link", { name: "PR 236" })).toHaveAttribute(
      "href",
      "https://github.com/sky-ecosystem/next-gen-atlas/pull/236",
    );
  });

  it("shows neither the PR author nor its comment count", () => {
    render(<EntryRow entry={entry({ pr: 236, prAuthor: "adamgfraser", commentCount: 7 })} />);
    expect(screen.queryByText(/adamgfraser/)).not.toBeInTheDocument();
    expect(screen.queryByText(/comments/)).not.toBeInTheDocument();
  });

  it("carries the shared line-height that centers the timeline dot on it", () => {
    // The dot's offset is derived from LINE1_H (see Timeline.tsx). If line 1 stops
    // using it the dot silently drifts off the date, which no snapshot would catch.
    const { container } = render(<EntryRow entry={entry({ pr: 1 })} />);
    expect(container.querySelector("h4")).toHaveStyle({ lineHeight: `${LINE1_H}px` });
  });

  it("links a bare commit as lowercase 'commit <sha>'", () => {
    render(<EntryRow entry={entry({ commitHash: "4e931df" })} />);
    expect(screen.getByText(/^commit/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "4e931df" })).toHaveAttribute(
      "href",
      "https://github.com/sky-ecosystem/next-gen-atlas/commit/4e931df",
    );
  });

  it("dates a severed-era birth by its window instead of calling it undated", () => {
    render(
      <EntryRow
        entry={entry({ date: "", commitHash: "severed:2024-09-02..2025-05-28", era: "severed", changeType: "added" })}
      />,
    );
    expect(screen.getByText("2024-09 ~ 2025-05")).toBeInTheDocument();
    expect(screen.queryByText("undated")).not.toBeInTheDocument();
    // The raw internal tag never reaches the reader.
    expect(screen.queryByText(/^severed:/)).not.toBeInTheDocument();
  });

  it("links the external source for a reconstructed pre-git origin", () => {
    render(
      <EntryRow
        entry={entry({ date: "2024-09-02", commitHash: "genesis:bafkre", era: "genesis", changeType: "added", sourceUrl: "https://ipfs.example/x" })}
      />,
    );
    expect(screen.getByRole("link", { name: "source →" })).toHaveAttribute("href", "https://ipfs.example/x");
  });

  it("badges only AI/human lineage on reconstructed entries", () => {
    const { rerender } = render(<EntryRow entry={entry({ era: "html", method: "ai" })} />);
    expect(screen.getByText("AI")).toBeInTheDocument();

    // Deterministic matching is the default — no badge for it, none off-era.
    rerender(<EntryRow entry={entry({ era: "html", method: "deterministic" })} />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    rerender(<EntryRow entry={entry({ method: "ai" })} />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });
});

describe("EntryRow change label", () => {
  // The paths are their own spans (each dimmed differently), so the sentence only
  // exists as the label's combined text — assert on that, not on one node.
  it("reads a move as one sentence with both paths", () => {
    const { container } = render(
      <EntryRow
        entry={entry({ changeType: "moved", movedFrom: "Sky Atlas/Sky Atlas.md", movedTo: "content/A/1/1/document.md" })}
      />,
    );
    expect(container.textContent).toContain("moved from Sky Atlas/Sky Atlas.md to content/A/1/1/document.md");
  });

  it("names the markdown migration's paths, which git records as a rewrite", () => {
    const { container } = render(<EntryRow entry={entry({ changeType: "moved", pr: 117 })} />);
    expect(container.textContent).toContain("moved from Sky Atlas.html to Sky Atlas.md");
  });

  it("says just 'moved' when there are no paths to show", () => {
    render(<EntryRow entry={entry({ changeType: "moved", pr: 236 })} />);
    expect(screen.getByText("moved")).toBeInTheDocument();
  });

  it("drops the redundant 'added' chip on a self-describing pre-git origin", () => {
    render(<EntryRow entry={entry({ era: "genesis", changeType: "added", summary: "Present at Atlas v2 genesis" })} />);
    expect(screen.getByText("Present at Atlas v2 genesis")).toBeInTheDocument();
    expect(screen.queryByText("added")).not.toBeInTheDocument();
  });

  it("honours a label override (the root snapshot is 'committed', not 'added')", () => {
    render(<EntryRow entry={entry({ era: "html", changeType: "added" })} labelOverride="committed" />);
    expect(screen.getByText("committed")).toBeInTheDocument();
  });
});
