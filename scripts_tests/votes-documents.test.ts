// Executive and poll parsing for `pnpm votes:sync`
// (scripts/lib/votes/executive.ts, scripts/lib/votes/poll.ts).

import { describe, expect, it } from "vitest";

import { filenameDate, parseExecutive, parseSections } from "../scripts/lib/votes/executive.ts";
import { parsePoll } from "../scripts/lib/votes/poll.ts";

const ADDRESS = "0x4d99868F6D4d2545EbFf3a1385efE31C06d3A472";

function executive(opts: { title?: string; date?: string; address?: string; body?: string } = {}): string {
  return [
    "---",
    `title: ${opts.title ?? "Template - [Executive Vote] Skybase Onboarding - January 29, 2026"}`,
    "summary: Onboard Skybase.",
    `date: ${opts.date ?? "2026-01-26T00:00:00.000Z"}`,
    `address: "${opts.address ?? ADDRESS}"`,
    "---",
    opts.body ?? "",
  ].join("\n");
}

const BODY = [
  "## Executive Summary",
  "Subject to the [GSM Pause Delay](https://sky-atlas.io/#3c9545d9-775f-4149-88bf-7d297b5302c6).",
  "## Proposal Details",
  "### Genesis Funding Transfers",
  "- **Authorization**: [Sky Atlas](https://sky-atlas.io/#7df88d38-0000-4000-8000-000000000001)",
  "- **Proposal**: [Forum post](https://forum.skyeco.com/t/genesis/27770)",
  "### Prime Agent Proxy Spells",
  "#### Spark",
  "  - **Authorization**: [Governance Poll 1628](https://vote.sky.money/polling/QmVAKhR6)",
  "#### Grove",
  "  - **Authorization**: [Snapshot Poll](https://snapshot.box/#/s:grovefinance.eth/proposal/0xf9)",
  "### [DC-IAM](https://sky-atlas.io/#93c9f662-4e0d-477e-8fc9-e3726877e842) Parameters Update",
  "- **Authorization**: [Atlas A.2.11.1.2.3](https://sky-atlas.io/#A.2.11.1.2.3)",
  "## Review",
  "See [the Atlas](https://sky-atlas.io/#00000000-0000-4000-8000-0000000000ff).",
].join("\n");

describe("parseExecutive", () => {
  it("keys on the filename date and keeps the frontmatter date beside it", () => {
    const e = parseExecutive("2026/executive-vote-2026-01-29-msc-pattern-and-skybase-onboarding.md", executive());
    expect(e.date).toBe("2026-01-29");
    expect(e.frontmatterDate).toBe("2026-01-26");
    expect(e.title).toBe("Skybase Onboarding - January 29, 2026");
    expect(e.address).toBe(ADDRESS);
    expect(e.portal).toBeNull();
  });

  it("accepts filenames without a slug and with the out-of-schedule prefix", () => {
    expect(parseExecutive("2025/executive-vote-2025-07-24.md", executive()).date).toBe("2025-07-24");
    const oos = parseExecutive("2025/oos-executive-vote-2025-11-17-solana-bridge-migration.md", executive());
    expect(oos).toMatchObject({ date: "2025-11-17", outOfSchedule: true });
  });

  it("records a drafted executive, still carrying the template placeholder, with a null address", () => {
    const e = parseExecutive("2026/executive-vote-2026-10-08-stusds.md", executive({ address: "$spell_address" }));
    expect(e.address).toBeNull();
  });

  it("throws on an address that is neither a spell address nor the placeholder", () => {
    expect(() => parseExecutive("2026/executive-vote-2026-10-08-x.md", executive({ address: "TBD" }))).toThrow(/neither/);
  });

  it("throws when the filename carries no date, since every date key depends on it", () => {
    expect(() => filenameDate("2026/executive-vote-latest.md")).toThrow(/no YYYY-MM-DD/);
  });
});

describe("parseSections", () => {
  const sections = parseSections(BODY);

  it("reads only the ### blocks under Proposal Details, in order", () => {
    expect(sections.map((s) => s.heading)).toEqual([
      "Genesis Funding Transfers",
      "Prime Agent Proxy Spells",
      "[DC-IAM](https://sky-atlas.io/#93c9f662-4e0d-477e-8fc9-e3726877e842) Parameters Update",
    ]);
    const all = sections.flatMap((s) => s.atlasRefs.map((l) => l.uuid));
    expect(all).not.toContain("3c9545d9-775f-4149-88bf-7d297b5302c6"); // Executive Summary boilerplate
    expect(all).not.toContain("00000000-0000-4000-8000-0000000000ff"); // Review section
  });

  it("separates authorization from proposal links", () => {
    expect(sections[0].authorization.map((l) => l.family)).toEqual(["atlas"]);
    expect(sections[0].proposal).toMatchObject([{ family: "forum", forumTopic: 27770 }]);
  });

  it("collects every labelled bullet at any depth, one per Prime", () => {
    expect(sections[1].authorization).toMatchObject([
      { family: "poll", pollId: 1628, pollSlug: "QmVAKhR6" },
      { family: "snapshot" },
    ]);
  });

  it("counts an atlas link in the heading as an atlas reference", () => {
    expect(sections[2].atlasRefs.map((l) => l.uuid ?? l.docNo)).toEqual([
      "93c9f662-4e0d-477e-8fc9-e3726877e842",
      "A.2.11.1.2.3",
    ]);
  });

  it("keeps each section's body as plain words, links reduced to their text", () => {
    expect(sections[0].text).toBe("- Authorization: Sky Atlas - Proposal: Forum post");
    expect(sections[2].text).not.toContain("sky-atlas.io");
  });

  it("returns no sections when there is no Proposal Details heading", () => {
    expect(parseSections("## Executive Summary\nNothing here.")).toEqual([]);
  });
});

describe("parsePoll", () => {
  it("reads its dates, discussion link and atlas references", () => {
    const md = [
      "---",
      "title: Atlas Edit Weekly Cycle Proposal - September 14, 2026",
      "summary: This Atlas edit proposal 1) equalizes staking reward rates",
      "discussion_link: https://forum.skyeco.com/t/atlas-edit/28234",
      "start_date: 2026-09-14T16:00:00",
      "end_date: 2026-09-17T16:00:00",
      "---",
      "An [Atlas Edit Weekly Cycle Proposal](https://sky-atlas.io/#14e99d92-71fc-44d9-9dbf-933bce2e1b32) on the forum.",
    ].join("\n");
    const p = parsePoll("2026/2026-09-14-Atlas-edit-weekly-cycle-proposal.md", md);
    expect(p).toMatchObject({ date: "2026-09-14", start: "2026-09-14T16:00:00", end: "2026-09-17T16:00:00" });
    expect(p.discussionLink).toBe("https://forum.skyeco.com/t/atlas-edit/28234");
    expect(p.atlasRefs).toMatchObject([{ family: "atlas", uuid: "14e99d92-71fc-44d9-9dbf-933bce2e1b32" }]);
  });

  it("leaves a missing discussion link null", () => {
    const md = ["---", "title: T", "start_date: 2025-06-02T16:00:00", "---", "body"].join("\n");
    expect(parsePoll("2025/2025-06-02-x.md", md).discussionLink).toBeNull();
  });
});
