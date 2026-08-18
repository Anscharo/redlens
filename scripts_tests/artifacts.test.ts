// Cross-artifact consistency.
//
// Each artifact in public/ is produced by a different script at a different
// time. Ensure references never dangle across the boundary — a doc_no cited by
// a relations.json edge that no longer exists in docs.json means someone edited
// one without rebuilding the other.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode, AddressInfo } from "../src/types";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

function loadJson<T>(name: string): T | null {
  const p = path.join(PUBLIC, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

const docs = (loadJson<{ nodes: Record<string, AtlasNode> }>("docs.json")?.nodes ?? {}) as Record<string, AtlasNode>;
const addresses = loadJson<Record<string, AddressInfo>>("addresses.json");
const atlasAddresses = loadJson<{ addresses: Record<string, { chain: string }> }>("addresses.atlas.json")?.addresses ?? null;
const glossary = loadJson<{ terms: Record<string, { nodeId: string }[]> }>("glossary.json")?.terms ?? null;
const relations = loadJson<{
  entities: { id: string; slug: string }[];
  edges: { f: string; t: string; e: string; s?: string[] }[];
}>("relations.json");

describe("cross-artifact consistency", () => {
  it("docs.json and addresses.json are in sync (within tolerance)", () => {
    // The ideal state is perfect symmetry, but addresses.json is the committed,
    // Etherscan-enriched artifact: it is only rebuilt by `build:addresses`,
    // which needs ETHERSCAN_API_KEY + chainlog network access. Neither PR CI
    // nor the atlas-update workflow rebuilds it, so a pure atlas bump that
    // introduces new on-chain addresses legitimately leaves them absent here
    // until an out-of-band enrichment run lands. That lag is expected and
    // benign — every ref is still guaranteed a chain entry by the
    // addresses.atlas.json test below.
    //
    // So this is a soft check: warn on everyday lag, and only HARD-FAIL on
    // catastrophic desync (addresses.json effectively unrelated to docs.json —
    // e.g. never rebuilt across many bumps, or hand-edited wholesale). A single
    // bump adds a handful of addresses; the bound must absorb several bumps'
    // worth of lag without tripping. Every ref is still guaranteed a chain
    // entry by the addresses.atlas.json test below.
    if (!addresses) return;
    const MAX_MISSING_RATIO = 0.05; // catastrophic-desync high-water mark

    const refsInDocs = new Set<string>();
    for (const n of Object.values(docs)) for (const r of n.addressRefs ?? []) refsInDocs.add(r);

    const missingInAddresses = [...refsInDocs].filter((r) => !addresses[r]);
    const orphanInAddresses = Object.keys(addresses).filter((a) => !refsInDocs.has(a));

    expect(missingInAddresses.length / Math.max(refsInDocs.size, 1)).toBeLessThan(MAX_MISSING_RATIO);

    if (missingInAddresses.length > 0) {
      console.warn(
        `  ${missingInAddresses.length} addressRefs in docs.json lack addresses.json entries ` +
          `(expected lag after an atlas bump) — run \`pnpm build:addresses\` with ETHERSCAN_API_KEY to enrich`,
      );
    }
    if (orphanInAddresses.length > 0) {
      console.warn(
        `  ${orphanInAddresses.length} stale entries in addresses.json (no longer referenced by any node)`,
      );
    }
  });

  it("every relations.json edge source_doc_nos resolves to a real doc_no", () => {
    if (!relations) return;
    const knownDocNos = new Set<string>();
    for (const n of Object.values(docs)) knownDocNos.add(n.doc_no);
    const bad: { edge: string; s: string }[] = [];
    for (const edge of relations.edges) {
      for (const s of edge.s ?? []) {
        if (!knownDocNos.has(s)) bad.push({ edge: edge.e, s });
      }
    }
    expect(bad).toEqual([]);
  });

  it("every addressRef has a chain entry in addresses.atlas.json", () => {
    if (!atlasAddresses) return;
    const missing: string[] = [];
    for (const node of Object.values(docs)) {
      for (const addr of node.addressRefs ?? []) {
        if (!atlasAddresses[addr]?.chain) missing.push(addr);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every glossary term's nodeId resolves to a real doc", () => {
    if (!glossary) return;
    const orphans: { term: string; nodeId: string }[] = [];
    for (const [term, entries] of Object.entries(glossary)) {
      for (const entry of entries) {
        if (!docs[entry.nodeId]) orphans.push({ term, nodeId: entry.nodeId });
      }
    }
    expect(orphans).toEqual([]);
  });

  it("relations.json entity slugs are unique", () => {
    if (!relations) return;
    const seen = new Map<string, string>();
    const dupes: { slug: string; ids: string[] }[] = [];
    for (const { id, slug } of relations.entities) {
      if (seen.has(slug)) {
        dupes.push({ slug, ids: [seen.get(slug)!, id] });
      } else {
        seen.set(slug, id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("history/*.json files are well-formed", () => {
    // History can reference past UUIDs that were renamed or removed from the
    // current atlas — that's the whole point of history. We don't require
    // every file to resolve to a current node, just that they parse and that
    // a large fraction still map to live docs (guard against catastrophic
    // drift where history stopped tracking entirely).
    const dir = path.join(PUBLIC, "history");
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let live = 0,
      orphan = 0;
    for (const f of files) {
      const uuid = f.replace(/\.json$/, "");
      JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (docs[uuid]) live++;
      else orphan++;
    }
    if (files.length > 0) {
      expect(live / files.length).toBeGreaterThan(0.5);
    }
    if (orphan > 0) {
      console.warn(
        `  ${orphan} history files reference UUIDs no longer in docs.json (atlas drift)`,
      );
    }
  });
});
