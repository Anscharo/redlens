// Semantic invariants for build-graph.mjs output.
//
// Each extraction pattern in the parse-atlas skill has to hold against the
// current graph.json / relations.json. These tests read the already-built
// artifacts — they don't re-run the build (too slow for every `pnpm test`).
// Run `pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode } from "../src/types";

// ---------------------------------------------------------------------------
// Load artifacts + shared indices
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

type GraphEntity = {
  id: string;
  slug: string;
  name: string;
  entity_type: string;
  subtype: string | null;
  defining_doc_id: string | null;
  is_active: number;
  meta: string | null;
};
type GraphEdge = {
  id: number;
  from_id: string;
  from_type: "doc" | "entity" | "address";
  to_id: string;
  to_type: "doc" | "entity" | "address";
  edge_type: string;
  source_doc_nos: string | null;
  weight: number;
  meta: string | null;
};
type Graph = { meta: unknown; entities: GraphEntity[]; edges: GraphEdge[] };

type RawParticipant = {
  id: string;
  slug: string;
  name: string;
  et: string;
  st: string | null;
  did: string | null;
};
type RelationEdge = {
  f: string;
  ft: string;
  t: string;
  tt: string;
  e: string;
  s?: string[];
  m?: string;
};
type Relations = { meta: unknown; entities: RawParticipant[]; edges: RelationEdge[] };

const graph: Graph = JSON.parse(fs.readFileSync(path.join(PUBLIC, "graph.json"), "utf8"));
const relations: Relations = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;

const entityById = new Map(graph.entities.map((e) => [e.id, e]));
const docByDocNo = new Map<string, AtlasNode>();
for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d);

function edgesOfType(t: string): GraphEdge[] {
  return graph.edges.filter((e) => e.edge_type === t);
}
function parseSources(e: GraphEdge): string[] {
  if (!e.source_doc_nos) return [];
  try {
    return JSON.parse(e.source_doc_nos);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Known vocabularies (must match the parse-atlas skill)
// ---------------------------------------------------------------------------

const KNOWN_ENTITY_TYPES = new Set([
  "agent",
  "composite_party",
  "foundation",
  "development_company",
  "operational_party",
  "governance_body",
  "facilitator_org",
  "govops_org",
  "delegate_org",
  "src_member",
  "ecosystem_actor",
  "instance",
  "invocation",
  "primitive",
  "multisig",
  "bridge",
]);

const KNOWN_EDGE_TYPES = new Set([
  // role edges
  "prime_agent_for",
  "operational_executor_agent_for",
  "core_executor_agent_for",
  "operational_facilitator_for",
  "core_facilitator_for",
  "operational_govops_for",
  "core_govops_for",
  "aligned_delegate_for",
  "ranked_delegate_for",
  // composition / membership
  "comprises",
  "erg_member_for",
  "responsible_party_for",
  "process_step_responsible_party_for",
  "duty_for",
  "holds_role_for",
  // accord / definition
  "ecosystem_accord",
  "defines_entity",
  // addresses
  "has_address",
  "mentions",
  "proxies_to",
  // structural doc ↔ doc
  "parent_of",
  "cites",
  "annotates",
  "active_data_for",
  "located_at",
  "instance_of",
  "invocation_of",
  "listed_in",
  "has_status",
  "implements",
  // instance → agent
  "invoked_by",
  // multisigs (Pattern 17)
  "signer_of",
  "can_modify_signers_of",
  // bridge validator sets (Pattern 21)
  "validator_of",
  // transfer/grant events (Pattern 18)
  "funds_transfer",
  // registries / org relations
  "authorized_rep_for",
  "integration_partner_of",
  "prime_foundation_of",
  "provides_services_to",
  // prime omni-doc governance metadata (Pattern 22)
  "governance_channel",
  "emergency_response",
  // pending operational transitions (Pattern 23)
  "pending_transition",
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("vocabulary stability", () => {
  it("every entity_type in graph.json is in the known vocabulary", () => {
    const unknown = [...new Set(graph.entities.map((e) => e.entity_type))].filter(
      (t) => !KNOWN_ENTITY_TYPES.has(t),
    );
    expect(unknown, "unknown entity_type — update KNOWN_ENTITY_TYPES or the skill").toEqual([]);
  });

  it("every edge_type in graph.json is in the known vocabulary", () => {
    const unknown = [...new Set(graph.edges.map((e) => e.edge_type))].filter(
      (t) => !KNOWN_EDGE_TYPES.has(t),
    );
    expect(unknown, "unknown edge_type — update KNOWN_EDGE_TYPES or the skill").toEqual([]);
  });
});

describe("Pattern 13 — bootstrap entities", () => {
  it("sky-core and sky-governance exist; sky-ecosystem does not", () => {
    const slugs = new Set(graph.entities.map((e) => e.slug));
    expect(slugs.has("sky-core")).toBe(true);
    expect(slugs.has("sky-governance")).toBe(true);
    expect(slugs.has("sky-ecosystem")).toBe(false);
  });

  it("sky-core has no defining_doc_id (no single anchor doc)", () => {
    const e = graph.entities.find((x) => x.slug === "sky-core");
    expect(e, "sky-core missing").toBeDefined();
    expect(e!.defining_doc_id).toBeNull();
  });

  it("sky-governance is anchored to A.1 (The Governance Scope)", () => {
    const e = graph.entities.find((x) => x.slug === "sky-governance");
    expect(e, "sky-governance missing").toBeDefined();
    // Check against UUID — doc_nos are not stable across atlas edits.
    // UUID 18ac7dd3 = A.1 (The Governance Scope)
    expect(e!.defining_doc_id).toBe("18ac7dd3-c646-4352-9b0d-d01a2932d7d1");
  });
});

describe("Pattern 1 — Prime Agents", () => {
  it("every agent/prime entity has exactly one prime_agent_for edge to sky-core", () => {
    const primes = graph.entities.filter((e) => e.entity_type === "agent" && e.subtype === "prime");
    const skyCore = graph.entities.find((e) => e.slug === "sky-core")!;
    expect(primes.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const prime of primes) {
      const outs = edgesOfType("prime_agent_for").filter((e) => e.from_id === prime.id);
      if (outs.length !== 1) bad.push(`${prime.name}: ${outs.length} edges (expected 1)`);
      else if (outs[0].to_id !== skyCore.id)
        bad.push(`${prime.name}: targets ${outs[0].to_id} (expected sky-core)`);
    }
    expect(bad).toEqual([]);
  });

  it("no prime_agent_for edge targets anything but sky-core", () => {
    const skyCoreId = graph.entities.find((e) => e.slug === "sky-core")!.id;
    const offTarget = edgesOfType("prime_agent_for").filter((e) => e.to_id !== skyCoreId);
    expect(offTarget).toEqual([]);
  });
});

describe("Pattern 2 — Sky Primitives", () => {
  it("every implements edge: source is A.6.1.1.*, target is A.2.2.*", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("implements")) {
      const src = docs[e.from_id],
        tgt = docs[e.to_id];
      if (!src?.doc_no.startsWith("A.6.1.1.")) bad.push(`src ${src?.doc_no}`);
      if (!tgt?.doc_no.startsWith("A.2.2.")) bad.push(`tgt ${tgt?.doc_no}`);
    }
    expect(bad).toEqual([]);
  });

  it("every instance_of edge target is a Primitive root at A.6.1.1.X.2.G.P", () => {
    // Tier nesting varies (Allocation System interposes a Multi-Instance Coordinator),
    // so "strip 2 segments" no longer holds. Invariant: target is the ICD's Primitive
    // root and its title ends in "Primitive".
    const bad: string[] = [];
    const ROOT_RE = /^A\.6\.1\.1\.\d+\.2\.\d+\.\d+$/;
    for (const e of edgesOfType("instance_of")) {
      const src = docs[e.from_id],
        tgt = docs[e.to_id];
      if (!src || !tgt) {
        bad.push(`missing doc for edge ${e.id}`);
        continue;
      }
      if (!ROOT_RE.test(tgt.doc_no))
        bad.push(`${src.doc_no} → ${tgt.doc_no} (target not a primitive root)`);
      if (!/Primitive$/i.test(tgt.title))
        bad.push(`${src.doc_no} → "${tgt.title}" (target title not "… Primitive")`);
      if (!src.doc_no.startsWith(tgt.doc_no + "."))
        bad.push(`${src.doc_no} → ${tgt.doc_no} (source is not under target)`);
    }
    expect(bad).toEqual([]);
  });

  it("every has_status edge: target doc_no = source doc_no + '.1.1'", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("has_status")) {
      const src = docs[e.from_id],
        tgt = docs[e.to_id];
      if (!src || !tgt) {
        bad.push(`missing doc for edge ${e.id}`);
        continue;
      }
      if (tgt.doc_no !== `${src.doc_no}.1.1`) {
        bad.push(`${src.doc_no} → ${tgt.doc_no} (expected ${src.doc_no}.1.1)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every located_at edge's source is an ICD Location (by title or by content)", () => {
    // The atlas occasionally has an ICD Location misnamed (title missing the
    // "Location" suffix); build-graph identifies them by content match too.
    const bad: string[] = [];
    const LOCATED_AT_CONTENT_RE =
      /^\s*This Instance[’']s associated Instance Configuration Document is located at/i;
    for (const e of edgesOfType("located_at")) {
      const src = docs[e.from_id];
      if (!src) {
        bad.push(`missing source for edge ${e.id}`);
        continue;
      }
      const byTitle = /instance configuration document location/i.test(src.title);
      const byContent = LOCATED_AT_CONTENT_RE.test(src.content ?? "");
      if (!byTitle && !byContent) bad.push(`${src.doc_no}: ${src.title}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 3 — Executor Agent role assignment", () => {
  it("operational_executor_agent_for: source is agent/operational_executor, target is agent/prime", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("operational_executor_agent_for")) {
      const src = entityById.get(e.from_id),
        tgt = entityById.get(e.to_id);
      if (src?.entity_type !== "agent" || src?.subtype !== "operational_executor") {
        bad.push(`src ${src?.name} (${src?.entity_type}/${src?.subtype})`);
      }
      if (tgt?.entity_type !== "agent" || tgt?.subtype !== "prime") {
        bad.push(`tgt ${tgt?.name} (${tgt?.entity_type}/${tgt?.subtype})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("core_executor_agent_for (when present): source is agent/core_executor, target is agent/prime", () => {
    const edges = edgesOfType("core_executor_agent_for");
    if (edges.length === 0) return;
    const bad: string[] = [];
    for (const e of edges) {
      const src = entityById.get(e.from_id),
        tgt = entityById.get(e.to_id);
      if (src?.entity_type !== "agent" || src?.subtype !== "core_executor")
        bad.push(`src ${src?.name}`);
      if (tgt?.entity_type !== "agent" || tgt?.subtype !== "prime") bad.push(`tgt ${tgt?.name}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 4 — Ecosystem Accords", () => {
  it("every ecosystem_accord edge's source is an A.2.8.2.* doc", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("ecosystem_accord")) {
      const src = docs[e.from_id];
      if (!src?.doc_no.match(/^A\.2\.8\.2\.\d+$/)) bad.push(src?.doc_no ?? e.from_id);
    }
    expect(bad).toEqual([]);
  });

  it("every ecosystem_accord edge's target is composite_party or sky-core", () => {
    // Sky always comprises Sky Core; build-graph short-circuits and points the
    // accord edge at the bootstrap rather than creating a "Sky" composite.
    const bad: string[] = [];
    for (const e of edgesOfType("ecosystem_accord")) {
      const tgt = entityById.get(e.to_id);
      if (!tgt) {
        bad.push(`missing entity ${e.to_id}`);
        continue;
      }
      if (tgt.entity_type !== "composite_party" && tgt.slug !== "sky-core") {
        bad.push(`${docs[e.from_id]?.doc_no} → ${tgt.name} (${tgt.entity_type})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 5 — Facilitator / GovOps assignments", () => {
  const rules: { edge: string; srcType: string }[] = [
    { edge: "operational_facilitator_for", srcType: "facilitator_org" },
    { edge: "core_facilitator_for", srcType: "facilitator_org" },
    { edge: "operational_govops_for", srcType: "govops_org" },
    { edge: "core_govops_for", srcType: "govops_org" },
  ];
  for (const r of rules) {
    it(`${r.edge}: source is ${r.srcType}, target is agent/*_executor`, () => {
      const edges = edgesOfType(r.edge);
      if (edges.length === 0) return; // the atlas may lack one of the four at any given snapshot
      const bad: string[] = [];
      for (const e of edges) {
        const src = entityById.get(e.from_id),
          tgt = entityById.get(e.to_id);
        if (src?.entity_type !== r.srcType) bad.push(`src ${src?.name} (${src?.entity_type})`);
        const tgtOk =
          tgt?.entity_type === "agent" &&
          (tgt?.subtype === "operational_executor" || tgt?.subtype === "core_executor");
        if (!tgtOk) bad.push(`tgt ${tgt?.name} (${tgt?.entity_type}/${tgt?.subtype})`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("Pattern 6 — Active Data", () => {
  it("every responsible_party_for edge targets an Active Data Controller doc", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("responsible_party_for")) {
      const tgt = docs[e.to_id];
      if (!tgt || tgt.type !== "Active Data Controller") {
        bad.push(`${tgt?.doc_no}: type=${tgt?.type}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every active_data_for edge's source doc_no matches *.0.6.X", () => {
    const re = /\.0\.6\.\d+$/;
    const bad: string[] = [];
    for (const e of edgesOfType("active_data_for")) {
      const src = docs[e.from_id];
      if (!src || !re.test(src.doc_no)) bad.push(src?.doc_no ?? e.from_id);
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 6-bis — process-step Responsible Party", () => {
  it("every process_step_responsible_party_for edge targets a non-ADC doc", () => {
    // Distinct from responsible_party_for (governance data-ownership, ADC-only) —
    // this is per-step execution RP on process-step "Update" docs.
    const bad: string[] = [];
    for (const e of edgesOfType("process_step_responsible_party_for")) {
      const tgt = docs[e.to_id];
      if (!tgt || tgt.type === "Active Data Controller") {
        bad.push(`${tgt?.doc_no}: type=${tgt?.type}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("is deduped per (doc, entity, declared role) — a doc with both an Operational and a Core step keeps both even if they resolve to the same entity", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of edgesOfType("process_step_responsible_party_for")) {
      const declared: string = e.meta ? (JSON.parse(e.meta).role_declared ?? "") : "";
      const role = /core\s*govops|core\s*facilitator/i.test(declared) ? "core" : "operational";
      const key = `${e.from_id}:${e.to_id}:${role}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });
});

describe("Pattern 7 — ERG membership", () => {
  // UUID e9807449 = A.1.8.1.2.2.0.6.1 (ERG Active Data doc)
  const ERG_UUID = "e9807449-fdc3-4860-8d53-c56181311618";
  it("every erg_member_for edge points at the single ERG Active Data doc", () => {
    expect(docs[ERG_UUID], `ERG doc ${ERG_UUID} absent from atlas`).toBeDefined();
    const bad = edgesOfType("erg_member_for").filter((e) => e.to_id !== ERG_UUID);
    expect(bad).toEqual([]);
  });
});

describe("Pattern 9 — supporting doc suffixes", () => {
  // Matches *.0.3.X (Annotation), *.0.4.X (Action Tenet), *.varX (Scenario Variation)
  const annotatedSuffix = /\.(0\.[34]\.\d+|\d+\.var\d+)(\.\d+)?$/;
  it("every annotates edge's source doc_no matches an annotation/tenet/variation pattern", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("annotates")) {
      const src = docs[e.from_id];
      if (!src || !annotatedSuffix.test(src.doc_no)) bad.push(src?.doc_no ?? e.from_id);
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 12 — composite parties", () => {
  it("every comprises edge's source is a composite_party entity", () => {
    const bad: string[] = [];
    for (const e of edgesOfType("comprises")) {
      const src = entityById.get(e.from_id);
      if (src?.entity_type !== "composite_party") {
        bad.push(`${src?.name ?? e.from_id} (${src?.entity_type})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("each accord emits one ecosystem_accord edge per party-details child doc", () => {
    // The real structural invariant: for every A.2.8.2.Y accord, the count of
    // ecosystem_accord edges leaving it equals the count of A.2.8.2.Y.1.1.N
    // party-details children. Atomic parties (Moonbow) have no members but are
    // still signatories, so per-party comprises count is the wrong invariant.
    const partyDocsByAccord = new Map<string, AtlasNode[]>();
    for (const d of Object.values(docs)) {
      const m = d.doc_no.match(/^(A\.2\.8\.2\.\d+)\.1\.1\.\d+$/);
      if (!m) continue;
      if (!partyDocsByAccord.has(m[1])) partyDocsByAccord.set(m[1], []);
      partyDocsByAccord.get(m[1])!.push(d);
    }
    const bad: string[] = [];
    for (const [accordDocNo, parties] of partyDocsByAccord) {
      const accordDoc = docByDocNo.get(accordDocNo);
      if (!accordDoc) {
        bad.push(`missing accord doc ${accordDocNo}`);
        continue;
      }
      const edges = edgesOfType("ecosystem_accord").filter((e) => e.from_id === accordDoc.id);
      if (edges.length !== parties.length) {
        bad.push(`${accordDocNo}: ${edges.length} accord edges vs ${parties.length} party docs`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every composite_party entity with members has ≥1 comprises edge", () => {
    // Parties whose doc contains "comprises A, B, and C" MUST surface members;
    // atomic-form parties (whose doc says "The party 'X' is <descriptor>") are
    // exempt. Distinguish by rescanning the source doc for "comprises".
    const compriseSources = new Set(edgesOfType("comprises").flatMap((e) => parseSources(e)));
    const bad: string[] = [];
    for (const ent of graph.entities) {
      if (ent.entity_type !== "composite_party") continue;
      const meta = ent.meta ? JSON.parse(ent.meta) : null;
      const sourceDocNo = meta?.source_doc_no;
      if (!sourceDocNo) continue;
      const sourceDoc = docByDocNo.get(sourceDocNo);
      if (!sourceDoc) continue;
      const hasComprisesPhrase = /\bcomprises\b/i.test(sourceDoc.content ?? "");
      if (hasComprisesPhrase && !compriseSources.has(sourceDocNo)) {
        bad.push(`${ent.name} (${sourceDocNo}) says "comprises" but emits no edge`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every 'Sky' party doc (*.1.1.1) resolves via ecosystem_accord to sky-core", () => {
    const skyCoreId = graph.entities.find((e) => e.slug === "sky-core")!.id;
    const skyPartyDocs = Object.values(docs).filter((d) =>
      /^A\.2\.8\.2\.\d+\.1\.1\.1$/.test(d.doc_no),
    );
    expect(skyPartyDocs.length, "no Sky party docs found").toBeGreaterThan(0);
    // Each Sky party doc is the child of a party-dir doc, which is a child of an
    // accord doc. The accord doc's ecosystem_accord edges should include sky-core.
    const bad: string[] = [];
    for (const party of skyPartyDocs) {
      const accordDocNo = party.doc_no.split(".").slice(0, -3).join(".");
      const accordDoc = docByDocNo.get(accordDocNo);
      if (!accordDoc) {
        bad.push(`${party.doc_no}: accord ${accordDocNo} missing`);
        continue;
      }
      const accordEdges = edgesOfType("ecosystem_accord").filter((e) => e.from_id === accordDoc.id);
      if (!accordEdges.some((e) => e.to_id === skyCoreId)) {
        bad.push(`${accordDocNo}: no ecosystem_accord edge to sky-core`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("auditability", () => {
  it("every role edge carries ≥1 source_doc_no (auditable-edge requirement)", () => {
    // Structural edges (parent_of, defines_entity, has_address, proxies_to) are
    // exempt — they're derived from id references, not from prose. Table-derived
    // edges (listed_in, authorized_rep_for) are likewise exempt (Pattern 16).
    const STRUCTURAL = new Set([
      "parent_of", "defines_entity", "has_address", "proxies_to",
      "listed_in", "authorized_rep_for",
    ]);
    const bad: string[] = [];
    for (const e of graph.edges) {
      if (STRUCTURAL.has(e.edge_type)) continue;
      if (parseSources(e).length === 0) {
        bad.push(`${e.edge_type}: ${e.from_id} → ${e.to_id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("Pattern 11 — role bindings (holds_role_for)", () => {
  // Walk A.1.7.1 (Active Ecosystem Actors) the same way the extractor does:
  // each direct child is a role definition; its .2 child is the binding doc.
  const ACTIVE_ECOSYSTEM_ACTORS_UUID = "1ef5767b-60bc-446a-af45-4eccdb20c023";
  const CCRA_BINDING_UUID = "51b1fe46-2251-4078-a805-e2b40aaaf729";

  const aeaDoc = docs[ACTIVE_ECOSYSTEM_ACTORS_UUID];
  const pfx = aeaDoc?.doc_no ? aeaDoc.doc_no + "." : null;

  const bindings: { roleDef: typeof aeaDoc; bindingDoc: typeof aeaDoc }[] = [];
  if (pfx) {
    const roleDefDocs = Object.values(docs).filter(
      (d) => d.doc_no.startsWith(pfx) && !d.doc_no.slice(pfx.length).includes("."),
    );
    for (const roleDef of roleDefDocs) {
      const bindingDoc = Object.values(docs).find((d) => d.doc_no === roleDef.doc_no + ".2");
      if (bindingDoc && /role is held by\s+([^.]+)\./i.test(bindingDoc.content ?? ""))
        bindings.push({ roleDef, bindingDoc });
    }
  }

  it("A.1.7.1 section exists and contains the known CCRA binding", () => {
    expect(aeaDoc, "Active Ecosystem Actors section missing").toBeTruthy();
    expect(
      bindings.some((b) => b.bindingDoc.id === CCRA_BINDING_UUID),
      "CCRA binding UUID not found — A.1.7.1 may have restructured",
    ).toBe(true);
  });

  for (const { roleDef, bindingDoc } of bindings) {
    it(`${roleDef.title} → holds_role_for edge with correct holder and slug`, () => {
      const holderName = (bindingDoc.content ?? "")
        .match(/role is held by\s+([^.]+)\./i)![1]
        .trim();
      const expectedSlug = roleDef.title.toLowerCase().replace(/\s+/g, "_");

      const edge = graph.edges.find(
        (e) => e.edge_type === "holds_role_for" && e.to_id === bindingDoc.id,
      );
      expect(edge, `no holds_role_for edge for ${roleDef.title}`).toBeTruthy();

      const holder = entityById.get(edge!.from_id);
      expect(holder?.name, `holder name mismatch for ${roleDef.title}`).toBe(holderName);

      const meta = edge!.meta ? JSON.parse(edge!.meta) : {};
      expect(meta.role, `role slug mismatch for ${roleDef.title}`).toBe(expectedSlug);
    });
  }
});

describe("relations.json — lean browser payload", () => {
  it("only pinned ecosystem_actors survive (load-bearing role/RP edges)", () => {
    // Most ecosystem_actors are filtered from relations.json. Actors that are the
    // source of a load-bearing edge are pinned so their relationship survives
    // (e.g. BA Labs → Core Council Risk Advisor; multisig signers; integration
    // partners). Mirrors KEEP_ACTOR_EDGE_TYPES in build-graph.mjs.
    const PINNED_EDGE_TYPES = new Set([
      "holds_role_for",
      "responsible_party_for",
      "process_step_responsible_party_for",
      "duty_for",
      "signer_of",
      "can_modify_signers_of",
      "integration_partner_of",
      "validator_of",
    ]);
    const pinned = new Set(
      relations.edges
        .filter((e) => PINNED_EDGE_TYPES.has(e.e) && e.ft === "entity")
        .map((e) => e.f),
    );
    const bad = relations.entities
      .filter((e) => e.et === "ecosystem_actor")
      .filter((e) => !pinned.has(e.id));
    expect(bad.map((e) => e.name)).toEqual([]);
  });

  it("contains zero parent_of edges (filtered by design)", () => {
    const bad = relations.edges.filter((e) => e.e === "parent_of");
    expect(bad.length).toBe(0);
  });

  it("no edge has an entity endpoint missing from the entity list", () => {
    const ids = new Set(relations.entities.map((e) => e.id));
    const dangling = relations.edges.filter(
      (e) => (e.ft === "entity" && !ids.has(e.f)) || (e.tt === "entity" && !ids.has(e.t)),
    );
    expect(dangling.map((e) => `${e.e}: ${e.f} → ${e.t}`)).toEqual([]);
  });
});

describe("Pattern 21 — bridge validator sets", () => {
  const bridges = graph.entities.filter((e) => e.entity_type === "bridge");
  const SOLANA_GOV_BRIDGE = "07d43b8c-1230-4de9-959b-8593d69e922a"; // A.1.10.4.1.2.3.3.2

  it("extracts the six SkyLink bridge components", () => {
    // 3 networks (Solana/Avalanche/Plasma) × Token Bridge + Governance Bridge.
    // UUID-anchored, not count-exact: new deployments (e.g. the SLL Governance
    // Bridges from atlas PRs #230/#233) legitimately grow the set — that delta
    // belongs in the snapshot diff, not a test failure.
    const SKYLINK_BRIDGE_ROOTS = [
      "16b49e7d-7360-41bf-ae7a-3c7380972987", // A.1.10.4.1.2.3.3.1 Token Bridge (Solana)
      "07d43b8c-1230-4de9-959b-8593d69e922a", // A.1.10.4.1.2.3.3.2 Governance Bridge (Solana)
      "3a3bcbb1-0989-4d62-80c3-7a71de0b022a", // A.1.10.4.1.3.3.3.1 Token Bridge (Avalanche)
      "6a24fd94-9915-468d-a2a4-14f222ff5980", // A.1.10.4.1.3.3.3.2 Governance Bridge (Avalanche)
      "658d9408-ecdd-4279-8f88-d1ed9e6bcd45", // A.1.10.4.1.4.3.3.1 Token Bridge (Plasma)
      "6aea3973-59ed-4f64-ad7f-4d1ad53e4357", // A.1.10.4.1.4.3.3.2 Governance Bridge (Plasma)
    ];
    const byId = new Set(bridges.map((b) => b.id));
    for (const id of SKYLINK_BRIDGE_ROOTS) {
      expect(byId.has(id), `missing bridge for root doc ${id}`).toBe(true);
    }
    for (const b of bridges) {
      const meta = JSON.parse(b.meta ?? "{}");
      expect(meta.quorum, b.name).toMatch(/^\d+\/\d+$/);
      expect(meta.quorum_doc_no, b.name).toBeTruthy();
      expect(docs[b.id], `${b.name} id must be its root doc UUID`).toBeDefined();
    }
  });

  it("Solana Governance Bridge: name, quorum, and full validator roster", () => {
    const b = entityById.get(SOLANA_GOV_BRIDGE);
    expect(b?.name).toBe("Governance Bridge (Solana SkyLink Bridge)");
    expect(JSON.parse(b?.meta ?? "{}").quorum).toBe("4/7");
    const validators = graph.edges
      .filter((e) => e.edge_type === "validator_of" && e.to_id === SOLANA_GOV_BRIDGE)
      .map((e) => entityById.get(e.from_id)?.name)
      .sort();
    expect(validators).toEqual(
      ["Canary", "Deutsche Telekom", "Horizen", "LayerZero", "Luganodes", "Nethermind", "P2P"],
    );
  });

  it("validators are deduped across bridges (one LayerZero entity, many edges)", () => {
    const lz = graph.entities.filter((e) => e.slug === "layerzero");
    expect(lz.length).toBe(1);
    expect(lz[0].subtype).toBe("bridge_validator");
    const lzEdges = graph.edges.filter(
      (e) => e.edge_type === "validator_of" && e.from_id === lz[0].id,
    );
    // Validates all six SkyLink components today; a floor, not an exact count —
    // new bridges may or may not include LayerZero.
    expect(lzEdges.length).toBeGreaterThanOrEqual(6);
  });

  it("Root Edit Primitive 'Quorum Requirement' spec prose is not matched", () => {
    // A.2.2.6.* quorum docs are primitive spec text with no roster sibling —
    // the child-pair gate must exclude them.
    const rootEditBridge = bridges.find((b) =>
      JSON.parse(b.meta ?? "{}").quorum_doc_no?.startsWith("A.2.2.6."),
    );
    expect(rootEditBridge).toBeUndefined();
  });
});

describe("Pattern 22 — prime omni-doc governance metadata", () => {
  const channels = edgesOfType("governance_channel");
  const emergencies = edgesOfType("emergency_response");

  it("governance_channel + emergency_response are doc → entity(agent) with provenance", () => {
    for (const e of [...channels, ...emergencies]) {
      expect(e.from_type, "source is the omni doc").toBe("doc");
      expect(e.to_type, "target is an entity").toBe("entity");
      const agent = entityById.get(e.to_id);
      expect(agent?.entity_type, "target is a prime agent").toBe("agent");
      expect(agent?.subtype).toBe("prime");
      expect(parseSources(e).length, "carries source_doc_nos").toBeGreaterThan(0);
    }
  });

  it("every Prime Agent has a Sky Forum channel with its '<Agent> Prime' category", () => {
    // 8 prime agents → 8 forum channels; Discord is optional (Spark + Skybase today).
    const forums = channels.filter((e) => JSON.parse(e.meta ?? "{}").platform === "forum");
    expect(forums.length).toBe(8);
    for (const e of forums) {
      const meta = JSON.parse(e.meta ?? "{}");
      expect(meta.category, e.source_doc_nos ?? "").toMatch(/ Prime$/);
    }
    // Discord channels carry a URL, no category.
    const discords = channels.filter((e) => JSON.parse(e.meta ?? "{}").platform === "discord");
    expect(discords.length).toBeGreaterThanOrEqual(1);
    for (const e of discords) expect(JSON.parse(e.meta ?? "{}").url).toMatch(/^https?:\/\//);
  });

  it("emergency_response covers both scopes per agent and flags placeholder status", () => {
    // 8 agents × {ecosystem, agent_specific} = 16 today, all stubs.
    expect(emergencies.length).toBe(16);
    const scopes = emergencies.map((e) => JSON.parse(e.meta ?? "{}").scope).sort();
    expect(scopes.filter((s) => s === "ecosystem").length).toBe(8);
    expect(scopes.filter((s) => s === "agent_specific").length).toBe(8);
    for (const e of emergencies) {
      expect(["placeholder", "specified"]).toContain(JSON.parse(e.meta ?? "{}").status);
    }
  });

  it("omni governance metadata reaches relations.json as doc → entity (for the Radar Contact section)", () => {
    // Kept in the browser payload so the actor page can render Contact, but
    // doc → entity so it never enters the entity↔entity canvas (buildEntityEdges
    // filters ft === "entity" && tt === "entity").
    const rel = relations.edges.filter(
      (e) => e.e === "governance_channel" || e.e === "emergency_response",
    );
    expect(rel.length).toBeGreaterThan(0);
    for (const e of rel) {
      expect(e.ft).toBe("doc");
      expect(e.tt).toBe("entity");
    }
  });
});

describe("Pattern 23 — pending operational transitions", () => {
  const transitions = edgesOfType("pending_transition");

  it("pending_transition is doc(subject) → entity(future holder) with provenance", () => {
    expect(transitions.length).toBeGreaterThanOrEqual(5);
    for (const e of transitions) {
      expect(e.from_type).toBe("doc");
      expect(e.to_type).toBe("entity");
      const holder = entityById.get(e.to_id);
      // Future holders are Prime Agents or Sky bootstraps — never an ecosystem_actor.
      expect(["agent", "operational_party", "governance_body"]).toContain(holder?.entity_type);
      expect(parseSources(e).length).toBeGreaterThan(0);
    }
  });

  it("captures the known Sky Core → agent handoffs (SparkLend→Spark, Lite PSM→Grove)", () => {
    const byHolder = (name: string) =>
      transitions
        .map((e) => ({ doc: docByDocNo.get(parseSources(e)[0]), holder: entityById.get(e.to_id)?.name }))
        .filter((x) => x.holder === name);
    const toSpark = byHolder("Spark");
    const toGrove = byHolder("Grove");
    expect(toSpark.length).toBeGreaterThanOrEqual(1);
    expect(toGrove.length).toBeGreaterThanOrEqual(1);
    // SparkLend control transitions to Spark; Lite PSM / Andromeda to Grove.
    expect(transitions.some((e) => parseSources(e)[0] === "A.6.1.1.1.3.2.1")).toBe(true);
  });

  it("the overdue SparkLend-params handoff carries its estimated date in meta", () => {
    // A.6.1.1.1.2.2.2.2.1.2.4 — "estimated for September 17, 2025".
    const e = transitions.find((t) => parseSources(t)[0] === "A.6.1.1.1.2.2.2.2.1.2.4");
    expect(e).toBeDefined();
    const meta = JSON.parse(e!.meta ?? "{}");
    expect(meta.est_date).toMatch(/2025/);
    expect(meta.current_holder).toBe("Sky Core");
  });

  it("est_date stays a raw string (no build-time overdue flag → deterministic)", () => {
    for (const e of transitions) {
      const meta = JSON.parse(e.meta ?? "{}");
      expect(meta).not.toHaveProperty("overdue");
    }
  });

  it("is graph.json-only (chat/MCP, not the canvas)", () => {
    expect(new Set(relations.edges.map((e) => e.e)).has("pending_transition")).toBe(false);
  });
});
