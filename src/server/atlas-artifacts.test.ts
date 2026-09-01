// atlas-artifacts.ts — the atlas_artifacts store (migration 027).
//
// DB MOCKING: every function here takes its `sql` tag as a parameter (same seam
// as chain-state.ts / preview/pr-state.ts), so these tests pass a fake directly
// and need no mock.module — nothing in this file touches the shared client
// except the DATABASE_URL-gated live test at the bottom, which uses it on purpose.
//
// What the fake CAN prove: the atomicity contract (every write goes through one
// transaction), the idempotency clause, the retention arithmetic, and the row →
// StoredArtifact mapping. What it CANNOT prove is that BYTEA survives a real
// Postgres round-trip — that is the live test's job, and until someone runs it
// with DATABASE_URL set, the bytea encoding is driver-verified only (see the
// migration's BYTEA note).
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { putArtifacts, getArtifacts, hasArtifacts, listArtifactShas, pruneArtifacts } from "./atlas-artifacts.ts";

interface Recorded { text: string; values: unknown[]; tx: boolean }
let queries: Recorded[] = [];
let rows: unknown[] = [];
let begins = 0;

function tag(tx: boolean) {
  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
    queries.push({ text: strings.join("?"), values, tx });
    return rows;
  };
}
const fakeSql = Object.assign(tag(false), {
  begin: async <T>(fn: (tx: ReturnType<typeof tag>) => Promise<T>): Promise<T> => {
    begins++;
    return fn(tag(true));
  },
});

const art = (name: string, bytes: number[]) => {
  const gz = Buffer.from(bytes);
  return { name, gz, rawBytes: gz.length * 4, sha256: createHash("sha256").update(gz).digest("hex") };
};

beforeEach(() => {
  queries = [];
  rows = [];
  begins = 0;
});

describe("putArtifacts", () => {
  it("writes the whole set inside ONE transaction — never a statement outside it", async () => {
    await putArtifacts("abc123", [art("a.json", [1]), art("b.json", [2]), art("c.json", [3])], fakeSql);
    expect(begins).toBe(1);
    expect(queries.length).toBe(3);
    // The failure this guards: a half-published sha, which a reader cannot tell
    // from a complete one.
    expect(queries.every((q) => q.tx)).toBe(true);
  });

  it("binds the gzip payload as a raw Buffer (bytea), not a string", async () => {
    const a = art("docs-shallow.json", [0x1f, 0x8b, 0x00, 0xff]);
    await putArtifacts("abc123", [a], fakeSql);
    const gz = queries[0]!.values[2];
    expect(Buffer.isBuffer(gz)).toBe(true);
    expect((gz as Buffer).equals(a.gz)).toBe(true);
    expect(queries[0]!.values[0]).toBe("abc123");
    expect(queries[0]!.values[1]).toBe("docs-shallow.json");
    expect(queries[0]!.values[3]).toBe(a.rawBytes);
    expect(queries[0]!.values[4]).toBe(a.sha256);
  });

  it("is idempotent: ON CONFLICT DO NOTHING, and a re-publish issues the same statements", async () => {
    const items = [art("a.json", [1]), art("b.json", [2])];
    await putArtifacts("abc123", items, fakeSql);
    const first = queries.map((q) => q.text);
    expect(first[0]).toContain("ON CONFLICT (atlas_sha, name) DO NOTHING");
    // Never DO UPDATE — overwriting a sha's bytes under a live reader is worse
    // than keeping the set already being served.
    expect(first[0]).not.toContain("DO UPDATE");

    queries = [];
    await putArtifacts("abc123", items, fakeSql);
    expect(queries.map((q) => q.text)).toEqual(first);
  });

  it("refuses an empty set rather than publishing a sha that reads back as absent", async () => {
    await expect(putArtifacts("abc123", [], fakeSql)).rejects.toThrow(/empty artifact set/);
    expect(begins).toBe(0);
    expect(queries.length).toBe(0);
  });
});

describe("getArtifacts", () => {
  it("maps rows to StoredArtifact and keeps the bytes intact", async () => {
    const gz = Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x41]);
    rows = [{ name: "glossary.json", gz, raw_bytes: 4096, sha256: "deadbeef" }];
    const out = await getArtifacts("abc123", undefined, fakeSql);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("glossary.json");
    expect(out[0]!.gz.equals(gz)).toBe(true);
    expect(out[0]!.rawBytes).toBe(4096);
    expect(out[0]!.sha256).toBe("deadbeef");
    expect(queries[0]!.values[0]).toBe("abc123");
  });

  it("accepts a bare Uint8Array from the driver, and a widened numeric raw_bytes", async () => {
    rows = [{ name: "a.json", gz: new Uint8Array([1, 2, 3]), raw_bytes: "4096", sha256: "x" }];
    const out = await getArtifacts("abc123", undefined, fakeSql);
    expect(Buffer.isBuffer(out[0]!.gz)).toBe(true);
    expect([...out[0]!.gz]).toEqual([1, 2, 3]);
    expect(out[0]!.rawBytes).toBe(4096);
  });

  it("throws on a non-bytes gz instead of handing back a blob that only fails at gunzip", async () => {
    rows = [{ name: "a.json", gz: "\\x010203", raw_bytes: 3, sha256: "x" }];
    await expect(getArtifacts("abc123", undefined, fakeSql)).rejects.toThrow(/not bytes/);
  });

  it("returns [] for a sha that was never published", async () => {
    rows = [];
    expect(await getArtifacts("never-published", undefined, fakeSql)).toEqual([]);
  });

  it("binds a names filter as a jsonb literal, never a bare JS array", async () => {
    // A bare `ANY(${array})` reaches Postgres as the comma-joined element text
    // without braces → `malformed array literal`, which broke every production
    // refresh-from-store tick on 2026-09-01. The raw array must go through a
    // `::jsonb` cast (Bun JSON-encodes it) and be unwrapped server-side —
    // pre-stringifying instead double-encodes into a jsonb string scalar,
    // which the live test below rejects.
    rows = [];
    await getArtifacts("abc123", ["a.json", "b.json"], fakeSql);
    expect(queries[0]!.text).toContain("jsonb_array_elements_text");
    expect(queries[0]!.text).toContain("::jsonb");
    // Raw array, not JSON.stringify'd — a string here is the double-encode that
    // the live test below rejected against Postgres 16.
    expect(queries[0]!.values[1]).toEqual(["a.json", "b.json"]);
    expect(typeof queries[0]!.values[1]).not.toBe("string");
  });
});

describe("listArtifactShas", () => {
  it("returns shas newest first, one per sha, under the caller's limit", async () => {
    rows = [{ atlas_sha: "new" }, { atlas_sha: "old" }];
    expect(await listArtifactShas(2, fakeSql)).toEqual(["new", "old"]);
    expect(queries[0]!.text).toContain("GROUP BY atlas_sha");
    expect(queries[0]!.text).toContain("ORDER BY newest DESC");
    expect(queries[0]!.values[0]).toBe(2);
  });
});

describe("pruneArtifacts", () => {
  it("deletes whole shas past the newest `keep` and reports each removed sha once", async () => {
    // One row per deleted FILE comes back; the caller wants shas.
    rows = [{ atlas_sha: "old1" }, { atlas_sha: "old1" }, { atlas_sha: "old2" }];
    expect(await pruneArtifacts(5, fakeSql)).toEqual(["old1", "old2"]);
    expect(queries[0]!.values[0]).toBe(5); // the OFFSET
    // One statement, not list-then-delete: the two-step version races a publish
    // that becomes the newest sha between the queries.
    expect(queries.length).toBe(1);
    expect(queries[0]!.text).toContain("DELETE FROM atlas_artifacts");
    expect(queries[0]!.text).toContain("RETURNING atlas_sha");
  });

  it("refuses keep < 1, which would empty the store", async () => {
    for (const bad of [0, -1, 1.5]) {
      await expect(pruneArtifacts(bad, fakeSql)).rejects.toThrow(/positive integer/);
    }
    expect(queries.length).toBe(0);
  });
});

// ── Live round-trip (skipped without DATABASE_URL) ────────────────────────────
// The ONLY check that proves BYTEA survives a real Postgres, which the mock
// above structurally cannot. Deliberately does NOT exercise pruneArtifacts:
// prune operates on the whole table, so running it here would delete real
// published shas if DATABASE_URL points at a shared database.
//
// Own connection, not `import("./db.ts")`: bun test runs files concurrently,
// and collections.test.ts / atlas-updater.test.ts mock.module("./db.ts")
// process-wide. Hitting their fake is what failed Railway's Postgres smoke
// (`unmocked query` / `unmocked unsafe` with this migration's SQL as the
// message). `new SQL(DATABASE_URL)` never goes through that export.
const LIVE = Boolean(process.env.DATABASE_URL);
const liveSha = `test-${randomUUID()}`;
let liveSql: SQL | null = null;

describe("live BYTEA round-trip (requires DATABASE_URL)", () => {
  it.skipIf(!LIVE)("publishes and reads back byte-identical blobs, twice", async () => {
    const db = new SQL(process.env.DATABASE_URL!);
    liveSql = db;
    await db.unsafe(readFileSync(join(import.meta.dir, "migrations/027_atlas_artifacts.sql"), "utf8")).simple();

    // Every byte value, plus a size past a single TCP segment — the two things
    // a mangled encoding (escaping, truncation, utf8 round-tripping) trips on.
    const big = Buffer.alloc(512 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7 + (i >> 11)) & 0xff;
    const items = [
      { name: "small.json", gz: Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x0a]), rawBytes: 12, sha256: "a".repeat(64) },
      { name: "big.json", gz: big, rawBytes: big.length * 3, sha256: createHash("sha256").update(big).digest("hex") },
    ];

    await putArtifacts(liveSha, items, db as unknown as Parameters<typeof putArtifacts>[2]);
    await putArtifacts(liveSha, items, db as unknown as Parameters<typeof putArtifacts>[2]); // idempotent — must not throw or duplicate

    const out = await getArtifacts(liveSha, undefined, db);
    expect(out.map((a) => a.name)).toEqual(["big.json", "small.json"]);
    for (const want of items) {
      const got = out.find((a) => a.name === want.name)!;
      expect(Buffer.isBuffer(got.gz)).toBe(true);
      expect(got.gz.equals(want.gz)).toBe(true);
      expect(got.rawBytes).toBe(want.rawBytes);
      expect(got.sha256).toBe(want.sha256);
    }
    expect(await listArtifactShas(50, db)).toContain(liveSha);

    // The names-filtered branch — the one the updater's refresh-from-store
    // actually calls — MUST hit a real server here: the fake-sql tests cannot
    // see an encoding Postgres rejects, and this exact call shipped broken
    // (`malformed array literal`, 2026-09-01) with every mocked test green.
    const filtered = await getArtifacts(liveSha, ["small.json", "absent.json"], db);
    expect(filtered.map((a) => a.name)).toEqual(["small.json"]);
    expect(filtered[0]!.gz.equals(items[0]!.gz)).toBe(true);
  });
});

afterAll(async () => {
  if (!liveSql) return;
  try {
    await liveSql`DELETE FROM atlas_artifacts WHERE atlas_sha = ${liveSha}`;
  } finally {
    await liveSql.end();
    liveSql = null;
  }
});

describe("hasArtifacts", () => {
  it("is a bounded existence probe, not a blob fetch — the worker calls it every cron tick", () => {
    // If this ever selected the blobs, the worker's fast path would pull ~3 MB
    // out of Postgres every 12 minutes just to answer a yes/no question.
    rows = [{ "?column?": 1 }];
    return hasArtifacts("abc", fakeSql).then((present) => {
      expect(present).toBe(true);
      expect(queries).toHaveLength(1);
      expect(queries[0].text).toContain("LIMIT 1");
      expect(queries[0].text).not.toContain("gz");
      expect(queries[0].values).toEqual(["abc"]);
    });
  });

  it("is false for a sha that was never published", async () => {
    rows = [];
    expect(await hasArtifacts("never-published", fakeSql)).toBe(false);
  });
});
