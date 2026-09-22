import { test, expect } from "bun:test";
import { upsertDocVersions, replaceDocVersions, readDocVersionsCursor, type DocVersionRow } from "./doc-versions-db.ts";

const row = (n: number, fingerprint: string | null = `fp${n}`): DocVersionRow => ({
  doc_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  commit_seq: n,
  commit_sha: "a".repeat(40),
  fingerprint,
});

function fakeSql(cursorRows: unknown[] = []) {
  const log: { kind: string; text: string; params: unknown[] }[] = [];
  const tag = (kind: string) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...params: unknown[]) => {
        log.push({ kind, text: strings.join("?"), params });
        return cursorRows;
      },
      {
        unsafe: async (text: string, params: unknown[]) => void log.push({ kind: `${kind}.unsafe`, text, params }),
      },
    );
  const sql = Object.assign(tag("sql"), {
    begin: async (fn: (tx: unknown) => Promise<void>) => {
      log.push({ kind: "begin", text: "", params: [] });
      await fn(tag("tx"));
      log.push({ kind: "commit", text: "", params: [] });
    },
  });
  return { sql: sql as never, log };
}

test("upsertDocVersions: every INSERT runs inside ONE transaction, a removal bound as null", async () => {
  const { sql, log } = fakeSql();
  await upsertDocVersions(sql, [row(1), row(2, null), row(3)], 2);
  expect(log.map((l) => l.kind)).toEqual(["begin", "tx.unsafe", "tx.unsafe", "commit"]);
  expect(log[1]!.text).toContain("INSERT INTO atlas_doc_versions (doc_id,commit_seq,commit_sha,fingerprint)");
  expect(log[1]!.text).toContain("ON CONFLICT (doc_id, commit_seq) DO UPDATE");
  expect(log[1]!.params).toHaveLength(8); // 2 rows × 4 columns
  expect(log[1]!.params[7]).toBeNull(); // row(2)'s fingerprint
  expect(log[2]!.params).toHaveLength(4);
});

test("upsertDocVersions: nothing to write issues no statement", async () => {
  const { sql, log } = fakeSql();
  await upsertDocVersions(sql, []);
  expect(log).toEqual([]);
});

test("replaceDocVersions: the DELETE and every INSERT run inside ONE transaction — never readable half-written", async () => {
  const { sql, log } = fakeSql();
  await replaceDocVersions(sql, [row(1), row(2), row(3)], 2);
  expect(log.map((l) => l.kind)).toEqual(["begin", "tx", "tx.unsafe", "tx.unsafe", "commit"]);
  expect(log[1]!.text).toContain("DELETE FROM atlas_doc_versions");
});

test("readDocVersionsCursor: the newest row's full sha; null on an empty table or a missing one", async () => {
  expect(await readDocVersionsCursor(fakeSql([{ commit_sha: "b".repeat(40) }]).sql)).toBe("b".repeat(40));
  expect(await readDocVersionsCursor(fakeSql([]).sql)).toBeNull();
  const broken = Object.assign(async () => Promise.reject(new Error('relation "atlas_doc_versions" does not exist')), {}) as never;
  expect(await readDocVersionsCursor(broken)).toBeNull();
});
