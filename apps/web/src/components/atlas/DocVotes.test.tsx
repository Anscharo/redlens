// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { AtlasNode } from "@/types";
import type { VoteIndex } from "@/lib/votes/vote-index";
import type { VoteEvidenceOverlay } from "@/lib/votes/overlay";

let record: { index: VoteIndex | null; overlay: VoteEvidenceOverlay | null } = { index: null, overlay: null };
vi.mock("../../lib/votes", () => ({ loadVoteRecord: () => Promise.resolve(record) }));

import { DocVotes } from "./DocVotes";
import { buildVoteIndex } from "@/lib/votes/vote-index";

afterEach(cleanup);

const doc: AtlasNode = {
  id: "d", doc_no: "A.1", title: "Osero", type: "Core", depth: 1, parentId: null, order: 0, addressRefs: [],
  content: "The transfer to Osero was included in the March 26, 2026 Executive Vote.",
};
const index = () =>
  buildVoteIndex({
    sources: { executives: "", polls: "", portal: null },
    polls: [],
    executives: [
      {
        file: "2026/e.md", date: "2026-03-26", frontmatterDate: null, outOfSchedule: false, title: "Genesis Funding", summary: "", address: "0x1",
        sections: [{ heading: "Transfers", text: "Transfer to the Launch Agent 6 SubProxy.", authorization: [], proposal: [], atlasRefs: [] }],
        portal: { key: "k", date: "2026-03-26", active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
      },
    ],
  });

describe("DocVotes", () => {
  it("lists the votes behind the document with why each is listed", async () => {
    record = { index: index(), overlay: null };
    render(<DocVotes id="d" docs={{ d: doc }} />);
    expect(screen.getByText("loading votes…")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "executive 2026-03-26" });
    expect(link).toHaveAttribute("href", "https://vote.sky.money/executive/k");
    expect(screen.getByText("Genesis Funding")).toBeInTheDocument();
    expect(screen.getByText("subject missing · via date")).toHaveAttribute("title", expect.stringContaining("never mentions"));
  });

  it("says when nothing links or dates the document, and when the record is missing", async () => {
    record = { index: index(), overlay: null };
    render(<DocVotes id="d" docs={{ d: { ...doc, content: "Nothing dated." } }} />);
    expect(await screen.findByText(/No vote links this section/)).toBeInTheDocument();
    cleanup();
    record = { index: null, overlay: null };
    render(<DocVotes id="d" docs={{ d: doc }} />);
    expect(await screen.findByText("Vote record unavailable.")).toBeInTheDocument();
  });
});
