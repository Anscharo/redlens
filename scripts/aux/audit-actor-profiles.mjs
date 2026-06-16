#!/usr/bin/env node
/**
 * Audit: for each prime agent, list the docs the actor profile would
 * associate with it (definition / instance / primitive / param), plus
 * a sample of summaries from those docs' history. Lets us eyeball:
 *  1. correct doc associations per prime, and
 *  2. whether matched bullet titles fit the actual change.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HISTORY_DIR = path.join(ROOT, "public/history");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const rels = JSON.parse(fs.readFileSync(path.join(ROOT, "public/relations.json"), "utf8"));

const entities = rels.entities;
const instances = entities.filter((e) => e.et === "instance");

// instance_of edges: doc -> primitive doc
const instanceOf = new Map();
for (const e of rels.edges) {
  if (e.e === "instance_of" && e.ft === "doc" && e.tt === "doc") instanceOf.set(e.f, e.t);
}

function ddoc(id) {
  const d = docs[id];
  return d ? `${d.doc_no} - ${d.title}` : "(unknown)";
}

function profileFor(slug) {
  const ent = entities.find((p) => p.slug === slug);
  if (!ent) return null;
  const did = ent.did;
  const cat = new Map(); // docId -> category
  if (did) cat.set(did, "definition");

  const insts = [];
  for (const inst of instances) {
    if (!inst.m) continue;
    let meta;
    try { meta = JSON.parse(inst.m); } catch { continue; }
    if (meta.agent_doc_id !== did) continue;
    insts.push({ inst, meta });
    if (inst.did) cat.set(inst.did, "instance");
    const primId = inst.did ? instanceOf.get(inst.did) : null;
    if (primId) cat.set(primId, "primitive");
    for (const t of Object.values(meta.params ?? {})) {
      const srcDocId = t[1];
      if (srcDocId && !cat.has(srcDocId)) cat.set(srcDocId, "param");
    }
  }
  return { entity: ent, did, instances: insts, cat };
}

function sampleSummaries(docId, limit = 4) {
  const p = path.join(HISTORY_DIR, `${docId}.json`);
  if (!fs.existsSync(p)) return [];
  const entries = JSON.parse(fs.readFileSync(p, "utf8"));
  return entries
    .filter((e) => e.summary && e.summary !== e.prTitle)
    .slice(0, limit)
    .map((e) => ({ pr: e.pr, commit: e.commitHash, summary: e.summary }));
}

const primes = entities.filter((e) => e.et === "agent" && e.st === "prime" && e.did);
for (const p of primes) {
  console.log(`\n=== ${p.name} (${p.slug}) ===`);
  const pf = profileFor(p.slug);
  if (!pf) { console.log("  no profile"); continue; }
  console.log(`  definingDoc: ${ddoc(pf.did)}  [${pf.did.slice(0, 8)}]`);
  console.log(`  ${pf.instances.length} instance(s)`);
  // group categories
  const byCat = { definition: [], instance: [], primitive: [], param: [] };
  for (const [id, c] of pf.cat) byCat[c].push(id);
  for (const c of ["definition", "instance", "primitive", "param"]) {
    if (byCat[c].length === 0) continue;
    console.log(`  ${c} (${byCat[c].length}):`);
    for (const id of byCat[c].slice(0, 6)) {
      const d = docs[id];
      console.log(`    ${d ? d.doc_no : "?"}  ${d ? d.title : "(missing)"}  [${id.slice(0, 8)}]`);
    }
    if (byCat[c].length > 6) console.log(`    … (+${byCat[c].length - 6} more)`);
  }
  // Sample summaries from definingDoc and 1-2 instances
  const sampleDocs = [pf.did, ...byCat.instance.slice(0, 2)];
  for (const id of sampleDocs) {
    const ss = sampleSummaries(id);
    if (ss.length === 0) continue;
    console.log(`  summaries on ${ddoc(id)}:`);
    for (const s of ss) console.log(`    [#${s.pr ?? "?"} ${s.commit}] ${s.summary}`);
  }
}
