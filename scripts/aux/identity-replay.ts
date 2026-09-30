// The identity gate's vector lane, end to end: replay one upstream atlas commit
// as if it were a preview of its parent, against the REAL Postgres and the REAL
// embedding provider. The only place the whole chain runs outside a preview
// build — the unit tests stub the store and the provider.
//
//   bun scripts/aux/identity-replay.ts [<atlas-commit>]      default 93f7f49
//
// Needs DATABASE_URL (a synced atlas_doc_embeddings, migrations applied) and
// OPENROUTER_API_KEY. Run it TWICE to see what a rebuild costs: the second run
// finds every vector kept in preview_vectors and asks the provider for nothing.
// Embeds every row of that commit the live store lacks — 520 for the default,
// about 11 seconds — and prints what the gate flags with and without vectors,
// with the time the build waits for beside the time the later lane takes.
// Off the `pnpm build` chain. 93f7f49 reordered the steps of a procedure, so
// several UUIDs there hold a different step than before: real repurposings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMBEDDINGS_INDEX_FILE } from "../../src/server/preview/embeddings.ts";
import { computeDiffArtifacts } from "../../src/server/preview/diff-artifacts.ts";
import { refineIdentity, refineJob, type IdentityJson } from "../../src/server/preview/identity-refine.ts";
import { sql } from "../../src/server/db.ts";
import { atlasGit, lineCount, snapshotNodes } from "./identity-corpus.ts";

const COMMIT = process.argv[2] ?? "93f7f49";
const { git, loadSnapshot } = atlasGit();
// docs.json carries more fields than a snapshot does; the row planner reads
// only id, doc_no, title, type and content, and the rest are filled in.
const nodesOf = (hash: string) => [...snapshotNodes(loadSnapshot(hash) as Map<string, any>).values()].map((n, i) => ({ ...n, depth: 6, parentId: null, order: i, addressRefs: [] }));
const headNodes = nodesOf(git(`rev-parse ${COMMIT}`)), baseNodes = nodesOf(git(`rev-parse ${COMMIT}^`));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-preview-"));
fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ nodes: Object.fromEntries(headNodes.map((n) => [n.id, n])) }));
const live = (await sql`SELECT count(*)::int AS n FROM atlas_doc_embeddings`) as { n: number }[];
console.log(`live store rows: ${live[0].n}; head docs ${headNodes.length}, base docs ${baseNodes.length}`);

const snap = (ns: any[]) => new Map(ns.map((n) => [n.id, n]));
const base = snap(baseNodes), head = snap(headNodes);

// What the BUILD does, and waits for: the diff, judged by lines and words.
const t0 = Date.now();
const before = computeDiffArtifacts(base, head, base).diff;
console.log(`the build's own diff: ${Date.now() - t0}ms — changed ${before.changed.length}, retitled ${Object.keys(before.retitled).length}`);

// What runs AFTER the preview is ready: the vectors, then the verdict by meaning.
const t1 = Date.now();
await refineIdentity(dir, [refineJob(["identity.json"], base, head, before)]);
const wrote = fs.existsSync(path.join(dir, "identity.json"));
console.log(`the later lane: ${Date.now() - t1}ms — identity.json ${wrote ? "written" : "NOT written (no API key, or the provider failed)"}`);
if (wrote) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, EMBEDDINGS_INDEX_FILE), "utf8"));
  const kept = (await sql`SELECT count(*)::int AS n, pg_size_pretty(pg_total_relation_size('preview_vectors')) AS size FROM preview_vectors`) as { n: number; size: string }[];
  console.log(`embeddings-index.json: model=${index.model} policy=${index.policy} rows=${index.rows.length} missing=${index.missing} size=${(fs.statSync(path.join(dir, EMBEDDINGS_INDEX_FILE)).size / 1e3).toFixed(0)}KB; preview_vectors holds ${kept[0].n} vectors, ${kept[0].size}`);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "identity.json"), "utf8")) as IdentityJson;
  console.log(`flagged WITHOUT vectors: ${Object.keys(before.identitySwap).length}; WITH vectors: ${Object.keys(after.identitySwap).length}`);
  const ids = new Set([...Object.keys(before.identitySwap), ...Object.keys(after.identitySwap)]);
  for (const id of ids) {
    const s = after.identitySwap[id] ?? before.identitySwap[id];
    console.log(`  ${id.slice(0, 8)} lines=${String(lineCount(base.get(id)!.content)).padStart(2)} without=${id in before.identitySwap ? "FLAG" : "  - "} with=${id in after.identitySwap ? "FLAG" : "  - "}  "${s.oldTitle}" -> "${s.newTitle}"${s.movedTo ? "  (moved to " + s.movedTo.doc_no + ")" : ""}`);
  }
}
fs.rmSync(dir, { recursive: true, force: true });
await sql.end();
