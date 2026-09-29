// The identity gate's vector lane, end to end: replay one upstream atlas commit
// as if it were a preview of its parent, against the REAL Postgres and the REAL
// embedding provider. The only place the whole chain runs outside a preview
// build — the unit tests stub the store and the provider.
//
//   bun scripts/aux/identity-replay.ts [<atlas-commit>]      default 93f7f49
//
// Needs DATABASE_URL (a synced atlas_doc_embeddings) and OPENROUTER_API_KEY.
// Embeds every row of that commit the live store lacks — 520 for the default,
// about 11 seconds — and prints what the gate flags with and without vectors.
// Off the `pnpm build` chain. 93f7f49 reordered the steps of a procedure, so
// several UUIDs there hold a different step than before: real repurposings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";
import { cleanContent } from "../lib/atlas-parser.mjs";
import { buildPreviewEmbeddings, bodySimilarity, EMBEDDINGS_FILE } from "../../src/server/preview/embeddings.ts";
import { computeDiffArtifacts } from "../../src/server/preview/diff-artifacts.ts";
import { sql } from "../../src/server/db.ts";

const COMMIT = process.argv[2] ?? "93f7f49";
const { git, loadSnapshot } = makeAtlasGitSource(path.resolve(import.meta.dir, "../../vendor/next-gen-atlas"));
const nodesOf = (hash: string) => [...(loadSnapshot(hash) as Map<string, any>)].map(([id, e], i) => ({
  id, doc_no: e.doc_no, title: e.title, type: e.type, depth: 6, parentId: null, order: i, addressRefs: [],
  content: cleanContent((e.content ?? "").split("\n")),
}));
const headNodes = nodesOf(git(`rev-parse ${COMMIT}`)), baseNodes = nodesOf(git(`rev-parse ${COMMIT}^`));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-preview-"));
fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ nodes: Object.fromEntries(headNodes.map((n) => [n.id, n])) }));
const live = (await sql`SELECT count(*)::int AS n FROM atlas_doc_embeddings`) as { n: number }[];
console.log(`live store rows: ${live[0].n}; head docs ${headNodes.length}, base docs ${baseNodes.length}`);

const t0 = Date.now();
const pv = await buildPreviewEmbeddings(dir);
console.log(`buildPreviewEmbeddings: ${pv ? "ok" : "NULL"} in ${Date.now() - t0}ms`);
if (pv) {
  const file = JSON.parse(fs.readFileSync(path.join(dir, EMBEDDINGS_FILE), "utf8"));
  console.log(`file: model=${file.model} dim=${file.dim} policy=${file.policy} rows=${file.rows.length} missing=${file.missing} size=${(fs.statSync(path.join(dir, EMBEDDINGS_FILE)).size / 1e6).toFixed(1)}MB vectorChars=${file.rows[0]?.vector.length}`);
  const snap = (ns: any[]) => new Map(ns.map((n) => [n.id, n]));
  const base = snap(baseNodes), head = snap(headNodes);
  const t1 = Date.now();
  const sim = await bodySimilarity(base, head, pv);
  console.log(`bodySimilarity: ${sim ? "ok" : "undefined"} in ${Date.now() - t1}ms`);
  const before = computeDiffArtifacts(base, head, base).diff;
  const after = computeDiffArtifacts(base, head, base, sim).diff;
  console.log(`changed ${after.changed.length}, retitled ${Object.keys(after.retitled).length}`);
  console.log(`flagged WITHOUT vectors: ${Object.keys(before.identitySwap).length}; WITH vectors: ${Object.keys(after.identitySwap).length}`);
  const ids = new Set([...Object.keys(before.identitySwap), ...Object.keys(after.identitySwap)]);
  for (const id of ids) {
    const s = after.identitySwap[id] ?? before.identitySwap[id];
    const lines = (base.get(id)!.content as string).split("\n").filter((l: string) => l.trim()).length;
    console.log(`  ${id.slice(0, 8)} lines=${String(lines).padStart(2)} cos=${sim?.(id)?.toFixed(3) ?? "  -  "} without=${id in before.identitySwap ? "FLAG" : "  - "} with=${id in after.identitySwap ? "FLAG" : "  - "}  "${s.oldTitle}" -> "${s.newTitle}"${s.movedTo ? "  (moved to " + s.movedTo.doc_no + ")" : ""}`);
  }
}
fs.rmSync(dir, { recursive: true, force: true });
await sql.end();
