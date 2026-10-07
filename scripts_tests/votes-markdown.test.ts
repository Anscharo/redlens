// Frontmatter reading and link classification for `pnpm votes:sync`
// (scripts/lib/votes/markdown.ts).

import { describe, expect, it } from "vitest";

import { classifyLink, extractLinks, readFrontmatter } from "../scripts/lib/votes/markdown.ts";

describe("readFrontmatter", () => {
  it("reads top-level scalars, unquotes them, and returns the body", () => {
    const md = [
      "---",
      "title: Template - [Executive Vote] Foo - May 15, 2025",
      'address: "0x53222d00ffbFf48bD74BddDE5592B1B98793bB07"',
      "summary: Phase One: the upgrade",
      "---",
      "# Heading",
    ].join("\n");
    const { fields, body } = readFrontmatter(md);
    expect(fields.title).toBe("Template - [Executive Vote] Foo - May 15, 2025");
    expect(fields.address).toBe("0x53222d00ffbFf48bD74BddDE5592B1B98793bB07");
    expect(fields.summary).toBe("Phase One: the upgrade");
    expect(body).toBe("# Heading");
  });

  it("skips nested structures instead of failing on them", () => {
    const md = ["---", "parameters:", "    input_format:", "        type: single-choice", "end_date: 2026-09-17T16:00:00", "---", ""].join("\n");
    const { fields } = readFrontmatter(md);
    expect(fields).toEqual({ end_date: "2026-09-17T16:00:00" });
  });

  it("treats a file without frontmatter as all body", () => {
    expect(readFrontmatter("# Just a heading")).toEqual({ fields: {}, body: "# Just a heading" });
  });
});

describe("classifyLink", () => {
  it("reads a uuid from a sky-atlas.io fragment, lowercased", () => {
    const l = classifyLink("https://sky-atlas.io/#6F8D5065-d6ff-4add-9a28-eadeffa7ed1a", "Sky Atlas");
    expect(l).toMatchObject({ family: "atlas", uuid: "6f8d5065-d6ff-4add-9a28-eadeffa7ed1a" });
  });

  it("keeps a doc_no fragment as a doc_no, never as a uuid", () => {
    const l = classifyLink("https://sky-atlas.io/#A.1.10.2.2", "Weekly Cycle");
    expect(l).toMatchObject({ family: "atlas-docno", docNo: "A.1.10.2.2" });
    expect(l.uuid).toBeUndefined();
  });

  it("keeps only the doc_no from a legacy powerhouse link", () => {
    const url = "https://sky-atlas.powerhouse.io/A.1.9.2.1_Pause_Delay/a98b8227-95f6-4711-9d8d-f52cbc6ad2d0%7C0db30758e055";
    const l = classifyLink(url, "GSM delay");
    expect(l).toMatchObject({ family: "powerhouse", docNo: "A.1.9.2.1" });
    expect(l.uuid).toBeUndefined();
  });

  it("keeps legacy agent-artifact and Prime-instance doc_nos whole", () => {
    const host = "https://sky-atlas.powerhouse.io";
    expect(classifyLink(`${host}/A.AG1.3.2.1.1.1.15_Slope_1_Definition/0b5b8b5e%7C9e1f`, "").docNo).toBe("A.AG1.3.2.1.1.1.15");
    expect(classifyLink(`${host}/A.AG1.2.6.P15.2.1.2.3_Token_Claim_Authorization/280f2ff0|7896`, "").docNo).toBe("A.AG1.2.6.P15.2.1.2.3");
  });

  it("yields no doc_no for an unknown segment shape rather than a truncated ancestor", () => {
    const l = classifyLink("https://sky-atlas.powerhouse.io/A.1.2.XYZW7_Title/abc", "");
    expect(l.family).toBe("powerhouse");
    expect(l.docNo).toBeUndefined();
  });

  it("reads a poll slug from the url and a poll id from the link text", () => {
    expect(classifyLink("https://vote.sky.money/polling/QmUnVyGg", "Governance Poll ID 1640")).toMatchObject({
      family: "poll",
      pollSlug: "QmUnVyGg",
      pollId: 1640,
    });
    expect(classifyLink("https://vote.sky.money/polling/QmVAKhR6", "Governance Poll 1628").pollId).toBe(1628);
  });

  it("tells executives, snapshot votes, forum threads and everything else apart", () => {
    expect(classifyLink("https://vote.sky.money/executive/template-executive-vote-foo", "").family).toBe("executive");
    expect(classifyLink("https://snapshot.box/#/s:grovefinance.eth/proposal/0xf97c", "Snapshot Poll").family).toBe("snapshot");
    expect(classifyLink("https://forum.skyeco.com/t/atlas-edit-weekly-cycle-proposal/28234/3", "")).toMatchObject({
      family: "forum",
      forumTopic: 28234,
    });
    expect(classifyLink("https://chainlog.sky.money", "Chainlog").family).toBe("other");
    expect(classifyLink("https://sky-atlas.io/", "home").family).toBe("other");
  });
});

describe("extractLinks", () => {
  it("finds markdown links and bare URLs without double-counting", () => {
    const links = extractLinks("[Sky Atlas](https://sky-atlas.io/#A.2.4) and https://forum.sky.money/t/x/1.");
    expect(links.map((l) => l.family)).toEqual(["atlas-docno", "forum"]);
    expect(links[1].url).toBe("https://forum.sky.money/t/x/1");
  });

  it("keeps a balanced parenthesis inside a URL whole", () => {
    const url = "https://sky-atlas.powerhouse.io/A.3.8.1.1.2.4.1_Maximum_Debt_Ceiling_(line)/6f1a913d-9436-4b70-816b-e317672737d6%7C57ea";
    const links = extractLinks(`Reduce [DC-IAM \`line\`](${url}) by 45 million.`);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ family: "powerhouse", url, docNo: "A.3.8.1.1.2.4.1" });
  });

  it("keeps a link written with a doubled opening paren", () => {
    const links = extractLinks("the following [rate limits]((https://sky-atlas.io/#A.2.2.9.1.1.1.2.2)):");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ family: "atlas-docno", docNo: "A.2.2.9.1.1.1.2.2" });
  });
});
