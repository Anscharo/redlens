// The vote index's Snapshot links: each Prime poll an executive's sections
// link, by its lowercased id, and the spaces those polls live in.
import { describe, expect, it } from "vitest";
import type { Executive, VotesArtifact } from "./types";
import { buildVoteIndex } from "./vote-index";

const snap = (space: string, id: string) => ({ family: "snapshot" as const, url: `https://snapshot.box/#/s:${space}/proposal/${id}`, text: "Snapshot" });
const executive = (date: string, links: ReturnType<typeof snap>[]): Executive => ({
  file: `${date}.md`, date, frontmatterDate: null, outOfSchedule: false, title: `Exec ${date}`, summary: "", address: "0x1", portal: null,
  sections: [{ heading: "Prime Agent Proxy Spells", text: "", authorization: links, proposal: [], atlasRefs: [] }],
});
const A = `0x${"a".repeat(64)}`;
const B = `0x${"B".repeat(64)}`;

describe("snapshot links", () => {
  it("indexes executives by the polls they link, and lists the spaces", () => {
    const artifact: VotesArtifact = {
      sources: { executives: "", polls: "", portal: null }, polls: [],
      executives: [executive("2026-11-05", [snap("sparkfi.eth", A), snap("grovefinance.eth", B), snap("sparkfi.eth", A)]), executive("2026-11-19", [snap("sparkfi.eth", A)])],
    };
    const index = buildVoteIndex(artifact);
    expect(index.snapshots?.get(A)?.map((e) => e.date)).toEqual(["2026-11-05", "2026-11-19"]);
    expect(index.snapshots?.get(B.toLowerCase())?.map((e) => e.date)).toEqual(["2026-11-05"]);
    expect(index.snapshotSpaces).toEqual(["grovefinance.eth", "sparkfi.eth"]);
  });
});
