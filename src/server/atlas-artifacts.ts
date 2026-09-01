// The atlas artifact store (migration 027) — the ONLY module that talks to
// atlas_artifacts. The worker publishes one gzipped blob per built file per
// atlas sha; every web instance reads them back instead of rebuilding.
// Plan: docs/plans/atlas-artifact-store.md.
//
// DB seam: every function takes its `sql` tag as a trailing parameter defaulting
// to the shared client, so tests pass a fake and the atlas worker can pass its
// own Bun.sql client without importing the web service's config-bound `sql`
// (same seam as chain-state.ts and preview/pr-state.ts).
import { sql } from "./db.ts";

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
// putArtifacts needs the transaction primitive too; the structural type keeps
// the fake in the tests a plain object rather than a whole Bun.sql stand-in.
interface SqlWithTx extends SqlTag {
  begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
}
const defaultSql = sql as unknown as SqlWithTx;

export interface StoredArtifact {
  name: string;
  /** gzip -9 of the raw file bytes. */
  gz: Buffer;
  /** Uncompressed length — a post-gunzip sanity check for the reader. */
  rawBytes: number;
  /** Hex sha256 of the RAW (uncompressed) bytes, so a reader can verify. */
  sha256: string;
}

interface Row {
  name: string;
  gz: unknown;
  raw_bytes: number | string;
  sha256: string;
}

// The driver hands bytea back as a Buffer (verified — see the migration's BYTEA
// note). Accept a bare Uint8Array too rather than trusting that across driver
// versions, and throw on anything else: a silently stringified blob would only
// surface as a corrupt gunzip much later, in a different process.
function toBuffer(v: unknown, name: string): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  throw new Error(`atlas_artifacts.gz for ${name} came back as ${typeof v}, not bytes`);
}

/**
 * Publish one sha's artifact set. Idempotent (a sha's bytes are fixed).
 *
 * ONE transaction for the whole set: a half-published sha is the same failure
 * class phase 0 removed from the disk store — a reader that finds *some* rows
 * for a sha treats it as published and serves an incomplete bundle.
 *
 * Refuses an empty set. Zero rows is indistinguishable from "never published"
 * on the read side, so a build that produced nothing would publish a sha that
 * silently isn't there; failing loudly at the producer is the recoverable half.
 */
export async function putArtifacts(
  atlasSha: string,
  items: StoredArtifact[],
  db: SqlWithTx = defaultSql,
): Promise<void> {
  if (items.length === 0) {
    throw new Error(`refusing to publish an empty artifact set for atlas ${atlasSha}`);
  }
  await db.begin(async (tx) => {
    for (const a of items) {
      // ON CONFLICT DO NOTHING, never DO UPDATE: same sha + same name means the
      // same bytes, so a re-publish (worker retry, redeploy) is a no-op — and
      // if the bytes ever DID differ, overwriting under a live reader would be
      // worse than keeping the set that is already being served.
      await tx`
        INSERT INTO atlas_artifacts (atlas_sha, name, gz, raw_bytes, sha256)
        VALUES (${atlasSha}, ${a.name}, ${a.gz}, ${a.rawBytes}, ${a.sha256})
        ON CONFLICT (atlas_sha, name) DO NOTHING
      `;
    }
  });
}

/** Every artifact for a sha, or [] when the sha was never published. */
export async function getArtifacts(
  atlasSha: string,
  names?: readonly string[],
  db: SqlTag = defaultSql,
): Promise<StoredArtifact[]> {
  // Filter in SQL, not after the fetch. The store holds the union of what any
  // consumer needs, and they need different subsets: the serve path wants only
  // servable artifacts, while phase 4's refresh wants graph.json too. Pulling
  // graph.json (~0.64 MB gz) on every cold serve miss and dropping it is the
  // kind of waste that only shows up once many instances are cold at once.
  // `names` empty/undefined means "everything for this sha".
  //
  // The filter goes through a jsonb round-trip, NOT a bare `ANY(${array})`:
  // Bun.sql encodes a JS array as the comma-joined element text without the
  // enclosing braces, which Postgres rejects with `malformed array literal` —
  // that exact error broke every refresh-from-store tick in production
  // (2026-09-01) because the mocked-sql tests never ran this binding against a
  // real server. The RAW array is passed (not JSON.stringify'd): Bun infers
  // jsonb from the `::jsonb` cast and JSON-encodes it itself; pre-stringifying
  // double-encodes into a jsonb string scalar (see the chat.ts jsonb note).
  const wanted = names && names.length ? [...names] : null;
  const rows = (await (wanted
    ? db`
    SELECT name, gz, raw_bytes, sha256
      FROM atlas_artifacts
     WHERE atlas_sha = ${atlasSha}
       AND name IN (SELECT jsonb_array_elements_text(${wanted}::jsonb))
     ORDER BY name
  `
    : db`
    SELECT name, gz, raw_bytes, sha256
      FROM atlas_artifacts
     WHERE atlas_sha = ${atlasSha}
     ORDER BY name
  `)) as Row[];
  return rows.map((r) => ({
    name: r.name,
    gz: toBuffer(r.gz, r.name),
    // INTEGER arrives as a number, but Number() also covers a driver that
    // widens it to a string, as Bun does for int8.
    rawBytes: Number(r.raw_bytes),
    sha256: r.sha256,
  }));
}

/**
 * Whether a sha has any artifacts published. One indexed lookup, not a blob
 * fetch — the atlas worker calls this on its fast path to answer "is the store
 * already populated for the sha sync_state points at?".
 *
 * That question exists because sync_state advancing and the artifacts being
 * published are separate events: a deploy that first ships publishing finds
 * sync_state already current, so without this probe the worker would skip the
 * build (and therefore the publish) until upstream next moved — which can be
 * days. Same failure shape the worker's structural-integrity check already
 * guards: a matching pointer alone does not mean the rows are there.
 */
export async function hasArtifacts(atlasSha: string, db: SqlTag = defaultSql): Promise<boolean> {
  const rows = (await db`
    SELECT 1 FROM atlas_artifacts WHERE atlas_sha = ${atlasSha} LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Published shas, newest first. `limit` is capped rather than optional-unbounded
 * because retention keeps a handful of shas — a caller wanting "all of them"
 * wants a number it chose, not an unbounded scan of a table nobody pruned.
 */
export async function listArtifactShas(limit = 50, db: SqlTag = defaultSql): Promise<string[]> {
  const rows = (await db`
    SELECT atlas_sha, MAX(created_at) AS newest
      FROM atlas_artifacts
     GROUP BY atlas_sha
     ORDER BY newest DESC, atlas_sha DESC
     LIMIT ${limit}
  `) as { atlas_sha: string }[];
  return rows.map((r) => r.atlas_sha);
}

/**
 * Drop all but the `keep` newest shas. Returns the shas removed (order
 * unspecified — it is the delete order, not a ranking).
 *
 * Whole shas, in one statement: a sha's files are only useful as a set, and a
 * two-step "list then delete" would race a concurrent publish of a sha that
 * became the newest between the two queries. Refuses keep < 1 — `keep = 0`
 * would empty the store, and nothing that calls prune ever means that.
 */
export async function pruneArtifacts(keep: number, db: SqlTag = defaultSql): Promise<string[]> {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`pruneArtifacts: keep must be a positive integer, got ${keep}`);
  }
  const rows = (await db`
    DELETE FROM atlas_artifacts
     WHERE atlas_sha IN (
       SELECT atlas_sha FROM (
         SELECT atlas_sha, MAX(created_at) AS newest
           FROM atlas_artifacts
          GROUP BY atlas_sha
          ORDER BY newest DESC, atlas_sha DESC
         OFFSET ${keep}
       ) stale
     )
    RETURNING atlas_sha
  `) as { atlas_sha: string }[];
  // One row per deleted FILE — collapse to the shas the caller cares about.
  return [...new Set(rows.map((r) => r.atlas_sha))];
}
