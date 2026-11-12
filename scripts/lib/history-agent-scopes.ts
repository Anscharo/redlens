// The agent name → doc_no scopes build-history's bullet matcher reads, so a PR
// bullet naming an agent ("Spark: raise the limit") matches inside that agent's subtree.

import fs from "node:fs";
import path from "node:path";

interface Entity {
  et?: string;
  did?: string;
  name?: string;
}

/** [name, doc_no prefix] for every agent entity with a document, longest name
 *  first so "Launch Agent 7" matches before "Launch Agent" would. Read from the
 *  built public/relations.json + docs.json under `root`; none without them. */
export function loadAgentNamePrefixes(root: string): [string, string][] {
  const relsPath = path.join(root, "public/relations.json");
  const docsPath = path.join(root, "public/docs.json");
  if (!fs.existsSync(relsPath) || !fs.existsSync(docsPath)) return [];
  const rels = JSON.parse(fs.readFileSync(relsPath, "utf8")) as { entities?: Entity[] };
  const docs = JSON.parse(fs.readFileSync(docsPath, "utf8")).nodes as Record<string, { doc_no?: string }>;
  const out: [string, string][] = [];
  for (const e of rels.entities ?? []) {
    if (e.et !== "agent" || !e.did || !e.name) continue;
    const docNo = docs[e.did]?.doc_no;
    if (docNo) out.push([e.name, docNo]);
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}
