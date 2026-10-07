// The I/O half of `pnpm votes:sync` and its report: the year-directory walk,
// the tarball fetch and JSON fetcher, and the stats lines
// (scripts/lib/votes/corpus.ts, fetch.ts, stats.ts).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { byDateThenFile, type JoinStats } from "../scripts/lib/votes/assemble.ts";
import { readVoteTree } from "../scripts/lib/votes/corpus.ts";
import { fetchJson, repoTree } from "../scripts/lib/votes/fetch.ts";
import { classifyLink } from "../scripts/lib/votes/markdown.ts";
import { summarize, summaryLine } from "../scripts/lib/votes/stats.ts";
import type { Executive, VotesArtifact } from "../src/lib/votes/types.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "votes-test-"));
  tmpDirs.push(d);
  return d;
}
function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("readVoteTree", () => {
  it("reads only <year>/*.md, sorted by date then path", () => {
    const root = tmp();
    write(root, "2026/2026-01-05-b.md", "b");
    write(root, "2026/2026-01-05-a.md", "a");
    write(root, "2025/2025-12-01-c.md", "c");
    write(root, "2025/notes.txt", "not markdown");
    write(root, "templates/2025-01-01-template.md", "not a year dir");
    write(root, "README.md", "root file");
    const rows = readVoteTree(root, (file, md) => ({ file, md, date: file.slice(5, 15) }));
    expect(rows.map((r) => r.file)).toEqual(["2025/2025-12-01-c.md", "2026/2026-01-05-a.md", "2026/2026-01-05-b.md"]);
  });

  it("throws on a missing checkout instead of reading it as empty", () => {
    expect(() => readVoteTree(path.join(tmp(), "nope"), (file) => ({ file, date: "" }))).toThrow(/does not exist/);
  });
});

describe("byDateThenFile", () => {
  it("orders by date, then by path within a date", () => {
    const rows = [{ date: "2026-01-02", file: "b" }, { date: "2026-01-01", file: "z" }, { date: "2026-01-02", file: "a" }];
    expect(rows.sort(byDateThenFile).map((r) => r.file)).toEqual(["z", "a", "b"]);
    // Code-point order: "B" (0x42) sorts before "a" (0x61), where a locale collation would not.
    const mixed = [{ date: "d", file: "a" }, { date: "d", file: "B" }];
    expect(mixed.sort(byDateThenFile).map((r) => r.file)).toEqual(["B", "a"]);
  });
});

describe("repoTree", () => {
  it("uses a local checkout as-is", async () => {
    const root = tmp();
    const tree = await repoTree("polls", root);
    expect(tree).toMatchObject({ root, source: root });
    tree.cleanup();
    expect(fs.existsSync(root)).toBe(true);
  });

  it("downloads and unpacks main's tarball, and cleanup removes it", async () => {
    const src = tmp();
    write(src, "polls-main/2026/2026-09-14-weekly.md", "---\ntitle: T\n---\n");
    const tgz = path.join(src, "main.tar.gz");
    execFileSync("tar", ["-czf", tgz, "-C", src, "polls-main"]);
    const bytes = fs.readFileSync(tgz);
    const fetchMock = vi.fn(async (_url: string) => new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tree = await repoTree("polls", undefined);
    expect(fetchMock.mock.calls[0][0]).toBe("https://github.com/sky-ecosystem/polls/archive/refs/heads/main.tar.gz");
    expect(path.basename(tree.root)).toBe("polls-main");
    expect(fs.existsSync(path.join(tree.root, "2026/2026-09-14-weekly.md"))).toBe(true);
    tree.cleanup();
    expect(fs.existsSync(tree.root)).toBe(false);
  });

  it("throws on a failed download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403, statusText: "Forbidden" })));
    await expect(repoTree("executive-votes", undefined)).rejects.toThrow(/403 Forbidden/);
  });
});

describe("fetchJson", () => {
  it("returns the parsed body and throws on a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: 1 })));
    await expect(fetchJson("https://vote.sky.money/api/x")).resolves.toEqual({ ok: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502, statusText: "Bad Gateway" })));
    await expect(fetchJson("https://vote.sky.money/api/x")).rejects.toThrow(/502 Bad Gateway/);
  });
});

describe("classifyLink", () => {
  it("treats an unparseable URL as other", () => {
    expect(classifyLink("https://", "")).toMatchObject({ family: "other" });
  });
});

function exec(over: Partial<Executive>): Executive {
  return { file: "2026/e.md", date: "2026-01-29", frontmatterDate: null, outOfSchedule: false, title: "", summary: "", address: "0x1", sections: [], portal: null, ...over };
}

describe("summarize", () => {
  const portal = { key: "k", date: "2026-01-26T00:00:00.000Z", active: false, hasBeenCast: true, datePassed: null, dateExecuted: null };
  const artifact: VotesArtifact = {
    sources: { executives: "e", polls: "p", portal: "https://vote.sky.money/api" },
    executives: [
      exec({
        file: "2026/executive-vote-2026-01-29-x.md",
        frontmatterDate: "2026-01-26",
        portal,
        sections: [{ heading: "H", text: "", proposal: [], authorization: [{ family: "poll", url: "u", text: "" }], atlasRefs: [{ family: "atlas", url: "u", text: "", uuid: "a" }] }],
      }),
      exec({ file: "2026/executive-vote-2026-10-08-y.md", date: "2026-10-08", address: null }),
    ],
    polls: [{ file: "2026/p.md", date: "2026-09-14", start: null, end: null, title: "", summary: "", discussionLink: null, atlasRefs: [], portal: { pollId: 1, slug: "s", multiHash: "m", tags: [], winner: "Yes", numVoters: 3 } }],
  };

  it("reports drafted executives, date drift, enactment, outcomes and links", () => {
    const text = summarize(artifact, null).join("\n");
    expect(text).toContain("executives  2  2026-01-29 → 2026-10-08  (out-of-schedule 0, drafted 1)");
    expect(text).toContain("drafted     2026/executive-vote-2026-10-08-y.md");
    expect(text).toContain("cast        1 of 1");
    expect(text).toContain("filename 2026-01-29, frontmatter 2026-01-26, portal 2026-01-26");
    expect(text).toContain("authorization links by family: poll 1");
    expect(text).toContain("outcomes    Yes 1");
    expect(text).toContain("atlas refs  atlas 1; 1 distinct uuids");
    expect(text).toContain("portal      not read");
  });

  it("lists join misses, or says everything joined", () => {
    const misses: JoinStats = { executivesWithoutPortal: ["2026/a.md"], portalExecutivesWithoutFile: 2, pollsWithoutPortal: ["2026/b.md"], portalPollsWithoutFile: 1, portalDuplicates: ["2026/c.md"] };
    const text = summarize(artifact, misses).join("\n");
    expect(text).toContain("no portal row for executive 2026/a.md");
    expect(text).toContain("no portal row for poll 2026/b.md");
    expect(text).toContain("2 portal executives have no file");
    expect(text).toContain("1 portal polls have no file");
    expect(text).toContain("portal lists 2026/c.md more than once; the later row was kept");
    const clean: JoinStats = { executivesWithoutPortal: [], portalExecutivesWithoutFile: 0, pollsWithoutPortal: [], portalPollsWithoutFile: 0, portalDuplicates: [] };
    expect(summarize(artifact, clean)).toContain("portal      every document joined");
  });

  it("sums up in one line, saying when the portal was not read", () => {
    expect(summaryLine(artifact, "public/votes.json")).toBe("votes: 2 executives, 1 polls (portal 1/2 executives, 1/1 polls) → public/votes.json");
    const offline = { ...artifact, sources: { ...artifact.sources, portal: null } };
    expect(summaryLine(offline, "(dry run)")).toBe("votes: 2 executives, 1 polls (no portal) → (dry run)");
  });

  it("prints (none) for an empty corpus", () => {
    expect(summarize({ ...artifact, executives: [], polls: [] }, null)[0]).toContain("(none)");
  });
});
