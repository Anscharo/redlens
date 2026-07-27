// TDD spec for §5 — wiring the frozen HTML-era artifact into atlas_history.
// RED until §5 is built. Run under `bun test` (NOT vitest — imports Bun SQL types).
//
// Pins three contracts, all ADDITIVE so the markdown era is untouched:
//   1. migration 009 adds era / seam / extracted_from / merged_into / move_kind
//   2. HISTORY_COLS + eventToRow carry those fields (null for markdown-era events)
//   3. htmlEraRows(artifact, seqByCommit) maps public/history-html-era.json → rows
//
// These map directly onto scripts/aux/prepare-html-history.mjs's output shape:
// events already carry { era, seam, extractedFrom, mergedInto, moveKind } and a
// 7-char commitHash; the artifact has { commits, docMeta, events }.

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { eventToRow, HISTORY_COLS, upsertAtlasPrs, upsertHistory, readHistoryCursor, gitCommitSeq } from "./history-db.ts";
import * as db from "./history-db.ts"; // namespace ref so a not-yet-built export is `undefined`, not a link error

const NEW_COLS = ["era", "seam", "extracted_from", "merged_into", "move_kind"] as const;
const seq = new Map<string, number>([["02a3eb1", 46], ["7b43d15", 79]]);
const UUID = "1ce24b08-84ff-4524-9710-49bba429c6ef"; // real v4
const SYN = "abccdeef-1111-5222-8333-444455556666";  // synthetic v5 (nibble at [14] = '5')
const PARENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("§5: migration 009 adds the additive columns", () => {
  it("a 009 migration exists and ALTERs atlas_history with the new columns", () => {
    const dir = new URL("../migrations/", import.meta.url);
    const file = readdirSync(dir).find((n) => n.startsWith("009") && n.endsWith(".sql"));
    expect(file).toBeTruthy();
    const sql = readFileSync(new URL(file!, dir), "utf8").toLowerCase();
    expect(sql).toContain("atlas_history");
    for (const c of NEW_COLS) expect(sql).toContain(c);
  });
});

describe("§5: HISTORY_COLS includes the additive columns", () => {
  for (const c of NEW_COLS) {
    it(`includes ${c}`, () => expect(HISTORY_COLS as readonly string[]).toContain(c));
  }
});

describe("§5: eventToRow maps HTML-era additive fields", () => {
  it("a `kept`/`split` added event carries era + seam + extracted_from", () => {
    const r = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "added", era: "html", seam: "split", extractedFrom: PARENT } as any, seq) as any;
    expect(r).not.toBeNull();
    expect(r.era).toBe("html");
    expect(r.seam).toBe("split");
    expect(r.extracted_from).toBe(PARENT);
    expect(r.merged_into).toBeNull();
    expect(r.commit_seq).toBe(46);
  });

  it("a `merged` synthetic added event carries merged_into", () => {
    const r = eventToRow(SYN, { commitHash: "7b43d15", changeType: "added", era: "html", seam: "merged", mergedInto: UUID } as any, seq) as any;
    expect(r.seam).toBe("merged");
    expect(r.merged_into).toBe(UUID);
    expect(r.extracted_from).toBeNull();
  });

  it("a moved event carries move_kind='doc_no' (and the existing structural mapping holds)", () => {
    const r = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "moved", era: "html", movedFrom: "A.2.8", movedTo: "A.2.10", moveKind: "doc_no" } as any, seq) as any;
    expect(r.move_kind).toBe("doc_no");
    expect(r.moved_from).toBe("A.2.8");
    expect(r.moved_to).toBe("A.2.10");
    expect(r.change_type).toBe("structural"); // CHANGE_TYPE_MAP unchanged
  });

  it("markdown-era events are UNAFFECTED — every new column is null (additive)", () => {
    const r = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "modified", diff: [] } as any, seq) as any;
    expect(r.era).toBeNull();
    expect(r.seam).toBeNull();
    expect(r.extracted_from).toBeNull();
    expect(r.merged_into).toBeNull();
    expect(r.move_kind).toBeNull();
    expect(r.method).toBeNull();
    expect(r.change_type).toBe("content"); // existing behaviour intact
  });

  it("an html-era event carries the per-change method (010 / §10.4); deterministic stays null", () => {
    const ai = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "modified", era: "html", method: "ai" } as any, seq) as any;
    expect(ai.method).toBe("ai");
    const det = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "modified", era: "html" } as any, seq) as any;
    expect(det.method).toBeNull();
  });
});

describe("§10.4: migration 010 + method column", () => {
  it("a 010 migration ALTERs atlas_history with method", () => {
    const dir = new URL("../migrations/", import.meta.url);
    const file = readdirSync(dir).find((n) => n.startsWith("010") && n.endsWith(".sql"));
    expect(file).toBeTruthy();
    const sql = readFileSync(new URL(file!, dir), "utf8").toLowerCase();
    expect(sql).toContain("atlas_history");
    expect(sql).toContain("method");
  });
  it("HISTORY_COLS includes method", () => expect(HISTORY_COLS as readonly string[]).toContain("method"));
});

describe("pre-git-history.md: migration 011 + source_url column", () => {
  it("a 011 migration ALTERs atlas_history with source_url", () => {
    const dir = new URL("../migrations/", import.meta.url);
    const file = readdirSync(dir).find((n) => n.startsWith("011") && n.endsWith(".sql"));
    expect(file).toBeTruthy();
    const sql = readFileSync(new URL(file!, dir), "utf8").toLowerCase();
    expect(sql).toContain("atlas_history");
    expect(sql).toContain("source_url");
  });
  it("HISTORY_COLS includes source_url", () => expect(HISTORY_COLS as readonly string[]).toContain("source_url"));
});

describe("PR metadata normalization: migration 012 + atlas_prs dual-write", () => {
  it("a 012 migration creates atlas_prs, backfills it, and exposes conflict audit view", () => {
    const dir = new URL("../migrations/", import.meta.url);
    const file = readdirSync(dir).find((n) => n.startsWith("012") && n.endsWith(".sql"));
    expect(file).toBeTruthy();
    const sql = readFileSync(new URL(file!, dir), "utf8").toLowerCase();
    expect(sql).toContain("create table if not exists atlas_prs");
    expect(sql).toContain("insert into atlas_prs");
    expect(sql).toContain("from atlas_history");
    expect(sql).toContain("create or replace view atlas_pr_metadata_conflicts");
  });

  it("upsertAtlasPrs writes one PR row with null-safe updates", async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const fakeSql = {
      unsafe: (query: string, params: unknown[]) => {
        calls.push({ query, params });
        return Promise.resolve([]);
      },
    };

    await upsertAtlasPrs(fakeSql as any, [
      {
        pr_number: 42,
        title: "Add Scope",
        url: "https://github.com/sky-ecosystem/next-gen-atlas/pull/42",
        author: "alice",
        review_count: 3,
        approval_count: 2,
        comment_count: 5,
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("INSERT INTO atlas_prs");
    expect(calls[0].query).toContain("COALESCE(excluded.title, atlas_prs.title)");
    expect(calls[0].params).toEqual([
      42,
      "Add Scope",
      "https://github.com/sky-ecosystem/next-gen-atlas/pull/42",
      "alice",
      3,
      2,
      5,
    ]);
  });
});

describe("pre-git-history.md: eventToRow falls back to a baked commit_seq for synthetic shas", () => {
  it("a git sha resolves through seqByCommit as before (unaffected)", () => {
    const r = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "added", commitSeq: 999 } as any, seq) as any;
    expect(r.commit_seq).toBe(46); // map hit wins over the baked value
  });

  it("a synthetic (non-git) sha absent from seqByCommit falls back to the event's baked commitSeq", () => {
    const r = eventToRow(UUID, { commitHash: "genesis:bafkreih7…", changeType: "added", era: "genesis", commitSeq: -20000 } as any, seq) as any;
    expect(r.commit_seq).toBe(-20000); // NOT null — this was the ingestion bug the fix guards
  });

  it("a synthetic sha with no baked commitSeq at all still nulls out (no silent garbage)", () => {
    const r = eventToRow(UUID, { commitHash: "mip:104:14.3", changeType: "added", era: "mip" } as any, seq) as any;
    expect(r.commit_seq).toBeNull();
  });

  it("maps sourceUrl to source_url; absent on git-derived events", () => {
    const withUrl = eventToRow(UUID, { commitHash: "mip:104:14.3", changeType: "added", era: "mip", commitSeq: -30000, sourceUrl: "https://github.com/sky-ecosystem/mips/blob/main/MIP104/MIP104.md" } as any, seq) as any;
    expect(withUrl.source_url).toBe("https://github.com/sky-ecosystem/mips/blob/main/MIP104/MIP104.md");
    const withoutUrl = eventToRow(UUID, { commitHash: "02a3eb1", changeType: "modified" } as any, seq) as any;
    expect(withoutUrl.source_url).toBeNull();
  });
});

describe("pre-git-history.md: preEraRows loads public/history-pre-era.json → upsertable rows", () => {
  const GENESIS_UUID = "2ce24b08-84ff-4524-9710-49bba429c6ef";
  const artifact = {
    meta: { kind: "pre-era-history" },
    events: [
      { docId: GENESIS_UUID, commitHash: "genesis:bafkreih7…", commitSeq: -20000, changeType: "added", era: "genesis", date: "2024-09-02", summary: "Present at Atlas v2 genesis", sourceUrl: "https://ipfs.io/ipfs/bafkreih7…" },
      { docId: SYN, commitHash: "severed:2024-09-02..2025-05-28", commitSeq: -10000, changeType: "removed", era: "severed" },
    ],
    bridge: [],
  };

  it("exports preEraRows", () => {
    expect(typeof (db as any).preEraRows).toBe("function");
  });

  it("maps every artifact event to a row with era + the BAKED commit_seq (never seqByCommit — synthetic shas never match it)", () => {
    const rows = (db as any).preEraRows(artifact, seq) as any[];
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.era === "genesis")!.commit_seq).toBe(-20000);
    expect(rows.find((r) => r.era === "severed")!.commit_seq).toBe(-10000);
    expect(rows.find((r) => r.era === "genesis")!.source_url).toBe("https://ipfs.io/ipfs/bafkreih7…");
  });

  it("produces rows whose keys are exactly HISTORY_COLS (upsert-shaped)", () => {
    const rows = (db as any).preEraRows(artifact, seq) as any[];
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...HISTORY_COLS].sort());
  });
});

describe("§5: htmlEraRows loads the frozen artifact → upsertable rows", () => {
  const artifact = {
    meta: { kind: "html-era-history" },
    commits: [{ sha: "02a3eb1", seq: 46, pr: 78 }],
    docMeta: { [UUID]: { seam: "kept" } },
    events: [
      { docId: UUID, commitHash: "02a3eb1", changeType: "added", era: "html", seam: "kept", date: "2025-10-16" },
      { docId: UUID, commitHash: "02a3eb1", changeType: "modified", era: "html", diff: [] },
    ],
    decisions: [],
  };

  it("exports htmlEraRows", () => {
    expect(typeof (db as any).htmlEraRows).toBe("function");
  });

  it("maps every artifact event to a row with era + resolved commit_seq + docId", () => {
    const rows = (db as any).htmlEraRows(artifact, seq) as any[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.era === "html")).toBe(true);
    expect(rows.every((r) => r.doc_id === UUID)).toBe(true);
    expect(rows.every((r) => r.commit_seq === 46)).toBe(true);
    expect(rows.find((r) => r.change_type === "added")!.seam).toBe("kept");
  });

  it("produces rows whose keys are exactly HISTORY_COLS (upsert-shaped)", () => {
    const rows = (db as any).htmlEraRows(artifact, seq) as any[];
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...HISTORY_COLS].sort());
  });
});

describe("gitCommitSeq", () => {
  it("returns a non-empty map of 7-char short shas to a 1-based topological order", () => {
    const m = gitCommitSeq();
    expect(m.size).toBeGreaterThan(0);
    for (const [sha, order] of m) {
      expect(sha).toHaveLength(7);
      expect(order).toBeGreaterThan(0);
    }
    // Oldest commit is seq 1; the reverse log walk is monotonic.
    expect([...m.values()].includes(1)).toBe(true);
  });
});

describe("upsertHistory", () => {
  it("writes zero rows without issuing any unsafe() call", async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const fakeSql = { unsafe: (query: string, params: unknown[]) => { calls.push({ query, params }); return Promise.resolve([]); } };
    await upsertHistory(fakeSql as any, []);
    expect(calls).toHaveLength(0);
  });

  it("upserts atlas_prs first, then atlas_history, with a jsonb-cast diff column and dedups PRs across rows", async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const fakeSql = { unsafe: (query: string, params: unknown[]) => { calls.push({ query, params }); return Promise.resolve([]); } };
    const rows = [
      eventToRow("d1", { commitHash: "aaa1111", changeType: "added", pr: 5, prTitle: "T", diff: [["+", "x"]] as any }, new Map())!,
      eventToRow("d2", { commitHash: "bbb2222", changeType: "modified", pr: 5, prTitle: "T2" }, new Map())!,
    ];
    await upsertHistory(fakeSql as any, rows);
    expect(calls).toHaveLength(2);
    expect(calls[0].query).toContain("INSERT INTO atlas_prs");
    expect(calls[0].params).toEqual([5, "T2", null, null, null, null, null]); // later row's pr_title wins (Map overwrite)
    expect(calls[1].query).toContain("INSERT INTO atlas_history");
    expect(calls[1].query).toContain("::jsonb");
    expect(calls[1].query).toContain("ON CONFLICT (doc_id, commit_sha, change_type) DO UPDATE SET");
  });

  it("chunks rows across multiple unsafe() calls when chunkSize is smaller than the row count", async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const fakeSql = { unsafe: (query: string, params: unknown[]) => { calls.push({ query, params }); return Promise.resolve([]); } };
    const rows = [
      eventToRow("d1", { commitHash: "aaa1111", changeType: "added" }, new Map())!,
      eventToRow("d2", { commitHash: "bbb2222", changeType: "added" }, new Map())!,
      eventToRow("d3", { commitHash: "ccc3333", changeType: "added" }, new Map())!,
    ];
    await upsertHistory(fakeSql as any, rows, 1);
    // No PRs on any row → upsertAtlasPrs makes zero calls; atlas_history chunks 3 rows into 3 calls.
    const historyCalls = calls.filter((c) => c.query.includes("INSERT INTO atlas_history"));
    expect(historyCalls).toHaveLength(3);
  });
});

describe("readHistoryCursor", () => {
  it("returns the commit_sha of the highest commit_seq row", async () => {
    const fakeSql = Object.assign(() => Promise.resolve([{ commit_sha: "aaa1111" }]), {});
    const result = await readHistoryCursor(fakeSql as any);
    expect(result).toBe("aaa1111");
  });

  it("returns null when the table is empty", async () => {
    const fakeSql = Object.assign(() => Promise.resolve([]), {});
    const result = await readHistoryCursor(fakeSql as any);
    expect(result).toBeNull();
  });

  it("returns null (not throw) when the query fails", async () => {
    const fakeSql = Object.assign(() => Promise.reject(new Error("no such table")), {});
    const result = await readHistoryCursor(fakeSql as any);
    expect(result).toBeNull();
  });
});
