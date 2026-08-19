import { describe, it, expect } from "bun:test";
import type { AtlasNode } from "../../types.ts";
import {
  isDocNoDescendant,
  parentDocNo,
  pickLeaf,
  rewriteSemanticHit,
  buildUnits,
  foldedIds,
  leafScore,
  DIRECTORY_RE,
  HUB_TITLE_RE,
  CHUNK_ROOT_MAX,
  parseCrumbStrategy,
  selectCrumbs,
  CRUMB_STRATEGIES,
} from "./embed-units.ts";
import { buildEmbedText, contentHash } from "./embed-text.ts";

function n(
  id: string,
  doc_no: string,
  title: string,
  content = "",
  type = "Core",
): AtlasNode {
  return {
    id,
    doc_no,
    title,
    type,
    depth: Math.min(doc_no.split(".").length, 6),
    parentId: null,
    content,
    order: 0,
    addressRefs: [],
  };
}

describe("isDocNoDescendant", () => {
  it("treats a child as under its parent via the trailing-dot rule", () => {
    expect(isDocNoDescendant("A.1.1.2", "A.1.1")).toBe(true);
    expect(isDocNoDescendant("A.1.1", "A.1.1")).toBe(false);
  });

  it("does not treat A.1.11 as a descendant of A.1.1", () => {
    expect(isDocNoDescendant("A.1.11", "A.1.1")).toBe(false);
    expect(isDocNoDescendant("A.1.11.1", "A.1.1")).toBe(false);
    expect(isDocNoDescendant("A.1.11.1", "A.1.11")).toBe(true);
  });

  it("nests supporting-doc suffixes under their host", () => {
    expect(isDocNoDescendant("A.1.4.5.0.4.1", "A.1.4.5")).toBe(true);
    expect(isDocNoDescendant("NR-1", "A.1")).toBe(false);
  });
});

describe("parentDocNo", () => {
  it("strips the last segment", () => {
    expect(parentDocNo("A.6.1.1.1")).toBe("A.6.1.1");
    expect(parentDocNo("A")).toBeNull();
  });
});

describe("pickLeaf / rewriteSemanticHit", () => {
  const icd = n("icd", "A.6.1.1.1.2.1.1.1", "SparkLend USDS Instance Configuration Document");
  const net = n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet");
  const code = n("code", "A.6.1.1.1.2.1.1.1.2", "Reward Code", "`128`.");
  const members = [icd, net, code];
  const docMap = new Map(members.map((d) => [d.id, d]));

  it("picks a child title match over an ICD whose title overlaps more query tokens", () => {
    const p = pickLeaf("SparkLend USDS Network", members, icd);
    expect(p.node.id).toBe("net");
    expect(p.match_scope).toBe("child");
  });

  it("keeps the ICD when the query matches the instance name more than any leaf", () => {
    const p = pickLeaf("SparkLend USDS Instance Configuration Document", members, icd);
    expect(p.node.id).toBe("icd");
    expect(p.match_scope).toBe("group");
  });

  it("rewrites a semantic ICD hit to the lexical child when that child is a descendant", () => {
    const out = rewriteSemanticHit(
      "network",
      "icd",
      ["icd", "net", "code"],
      [{ id: "net", doc_no: net.doc_no }],
      docMap,
    );
    expect(out.id).toBe("net");
    expect(out.via?.group_id).toBe("icd");
    expect(out.via?.match_scope).toBe("child");
  });

  it("does not fuse sibling leaves", () => {
    const out = rewriteSemanticHit(
      "network",
      "icd",
      ["icd", "net", "code"],
      [
        { id: "net", doc_no: net.doc_no },
        { id: "code", doc_no: code.doc_no },
      ],
      docMap,
    );
    // Query is "network" → pick Network; Reward Code is a sibling, not a descendant of Network.
    expect(out.id).toBe("net");
    expect(isDocNoDescendant(code.doc_no, net.doc_no)).toBe(false);
  });

  it("treats a non-array memberIds (Postgres uuid[] text) as the anchor alone, not a crash", () => {
    // Defense in depth: search.ts now parses the wire string, but a leftover
    // `{uuid,uuid}` must not throw `ids.map is not a function`.
    const out = rewriteSemanticHit("network", "icd", "{icd,net,code}" as unknown as string[], [], docMap);
    expect(out.id).toBe("icd");
    expect(out.via).toBeUndefined();
  });

  it("weights title matches above content matches", () => {
    expect(leafScore("network", net)).toBeGreaterThan(leafScore("network", code));
  });
});

describe("buildUnits policies", () => {
  const icd = n("icd", "A.6.1.1.1.2.1.1", "Spark Foo Instance Configuration Document", "The documents herein define this instance.");
  const params = n("params", "A.6.1.1.1.2.1.1.1", "Parameters", "The documents herein define the parameters.");
  const net = n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet");
  const tok = n("tok", "A.6.1.1.1.2.1.1.1.2", "Token", "USDS");
  const opd = n("opd", "A.6.1.1.1.2.1.1.2", "Operational Process Definition", "Long process prose about how to operate.");
  const docs = [icd, params, net, tok, opd];

  it("one_to_one matches embed-text.ts hashes so a policy no-op does not re-embed", () => {
    const units = buildUnits(docs, "one_to_one");
    expect(units).toHaveLength(5);
    const u = units.find((x) => x.anchorId === "net")!;
    expect(u.text).toBe(buildEmbedText(net));
    expect(u.hash).toBe(contentHash(net));
    expect(foldedIds(units).size).toBe(0);
  });

  it("icd_params folds Parameter leaves into the ICD and leaves OPD standalone", () => {
    const units = buildUnits(docs, "icd_params");
    const icdUnit = units.find((u) => u.anchorId === "icd")!;
    expect(icdUnit.memberIds.sort()).toEqual(["icd", "net", "params", "tok"].sort());
    expect(icdUnit.text).toContain("Network: Ethereum Mainnet");
    expect(icdUnit.text).toContain("Token: USDS");
    expect(foldedIds(units).has("net")).toBe(true);
    expect(foldedIds(units).has("tok")).toBe(true);
    expect(units.some((u) => u.anchorId === "opd")).toBe(true);
    expect(foldedIds(units).has("opd")).toBe(false);
  });

  it("icd_params_breadcrumbs folds like icd_params but prepends the ICD's bounded breadcrumb", () => {
    const gp = n("gp", "A.6.1.1.1.2", "Spark");
    const par = n("par", "A.6.1.1.1.2.1", "SparkLend");
    const fusedDocs = [gp, par, ...docs];
    const units = buildUnits(fusedDocs, "icd_params_breadcrumbs", { crumbDepth: 2 });
    const icdUnit = units.find((u) => u.anchorId === "icd")!;
    // Still folds the Parameters subtree like icd_params.
    expect(icdUnit.memberIds.sort()).toEqual(["icd", "net", "params", "tok"].sort());
    expect(icdUnit.family).toBe("icd_params_breadcrumbs");
    // Anchor text leads with the parent+grandparent crumb, then the kv params.
    expect(icdUnit.text.startsWith("Spark > SparkLend\n\n")).toBe(true);
    expect(icdUnit.text).toContain("Network: Ethereum Mainnet");
    expect(icdUnit.text).toContain("Token: USDS");
    // Standalone (unfolded) docs stay one_to_one — no crumb, so they reuse
    // an existing one_to_one embedding rather than becoming a cache miss.
    const opdUnit = units.find((u) => u.anchorId === "opd")!;
    expect(opdUnit.text).toBe(buildEmbedText(opd));
    expect(opdUnit.hash).toBe(contentHash(opd));
  });

  it("folds a sibling param container into its OWN unit, not the ICD's", () => {
    // `Instance-specific Operational Parameters` is a param block that the old
    // exact-title `=== "Parameters"` match skipped, leaving its bare-address
    // leaves embedded 1:1. It gets its own anchor rather than being merged, so the
    // ICD's anchor text stays inside the compact-anchor budget.
    const iso = n("iso", "A.6.1.1.1.2.1.1.3", "Instance-specific Operational Parameters", "The documents herein define them.");
    const addr = n("addr", "A.6.1.1.1.2.1.1.3.1", "Curator Role Address", "`0x0f963A8A8c01042B69054e787E5763ABbB0646A3`");
    const units = buildUnits([...docs, iso, addr], "icd_params");

    const isoUnit = units.find((u) => u.anchorId === "iso")!;
    expect(isoUnit.memberIds.sort()).toEqual(["addr", "iso"]);
    // formatParam unwraps the backtick code span, so the bare address lands in the text.
    expect(isoUnit.text).toContain("Curator Role Address: 0x0f963A8A8c01042B69054e787E5763ABbB0646A3");
    // The instance name rides along, so a generic container title stays attributable.
    expect(isoUnit.text).toContain("Spark Foo Instance Configuration Document — Instance-specific Operational Parameters");

    // The thin leaf is folded; the container is an anchor, so NOT folded.
    const folded = foldedIds(units);
    expect(folded.has("addr")).toBe(true);
    expect(folded.has("iso")).toBe(false);
    // The ICD's own unit is untouched by the sibling container.
    expect(units.find((u) => u.anchorId === "icd")!.memberIds.sort()).toEqual(["icd", "net", "params", "tok"].sort());
  });

  it("kv_records_breadcrumbs folds a generic kv record the ICD pass doesn't reach", () => {
    // A multisig-shaped record outside any ICD: thin value leaves under a
    // generically-titled container.
    const ms = n("ms", "A.2.9.1.1", "Freezer Multisig", "The documents herein define the multisig.");
    const a1 = n("a1", "A.2.9.1.1.1", "Address", "The address is `0x38d1114b4cE3e079CC0f627df6aC2776B5887776`.");
    const a2 = n("a2", "A.2.9.1.1.2", "Required Number Of Signers", "It has a 2/5 signing requirement.");
    const units = buildUnits([...docs, ms, a1, a2], "kv_records_breadcrumbs", { crumbDepth: 2 });
    const msUnit = units.find((u) => u.anchorId === "ms")!;
    expect(msUnit.family).toBe("kv_records");
    expect(msUnit.memberIds.sort()).toEqual(["a1", "a2", "ms"]);
    expect(msUnit.text).toContain("2/5 signing requirement");
    const folded = foldedIds(units);
    expect(folded.has("a1")).toBe(true);
    expect(folded.has("a2")).toBe(true);
    // The ICD pass still runs first and owns its own subtree.
    expect(units.find((u) => u.anchorId === "icd")!.memberIds).toContain("net");
  });

  it("kv_records_breadcrumbs rejects scaffolding-only records", () => {
    // "…are stored here" / "None." are structural placeholders, not values.
    // Folding these produced 136 near-identical vectors in the corpus census.
    const dir = n("arch", "A.2.9.2.1", "Archived Invocations/Instances", "The documents herein organize them.");
    const s1 = n("s1", "A.2.9.2.1.1", "Suspended Instances", "The subtrees for Instances with `Suspended` Status are stored here.");
    const s2 = n("s2", "A.2.9.2.1.2", "Failed Invocations", "None.");
    const units = buildUnits([...docs, dir, s1, s2], "kv_records_breadcrumbs", { crumbDepth: 2 });
    expect(units.find((u) => u.anchorId === "arch")!.memberIds).toEqual(["arch"]);
    expect(foldedIds(units).has("s1")).toBe(false);
  });

  it("strips markdown links from grouped kv values, matching buildEmbedText", () => {
    // Consequence of link-stripping in embed-text.ts: a grouped anchor must not
    // carry raw link targets when its 1:1 siblings don't. Stripped in kvText, NOT
    // in the shared param extractor — the graph build needs the raw markdown to
    // pull addresses and emit has_address edges.
    const linked = n("lnk", "A.6.1.1.1.2.1.1.1.3", "Owner", "See [A.1.2 - Owner Spec](9a8120c4-0a5b-426f-97a5-283c708413f5).");
    const units = buildUnits([...docs, linked], "icd_params");
    const icdUnit = units.find((u) => u.anchorId === "icd")!;
    expect(icdUnit.text).toContain("Owner: See A.1.2 - Owner Spec.");
    expect(icdUnit.text).not.toContain("9a8120c4");
  });

  it("icd_full_params_breadcrumbs keeps folded members' full prose plus the param kv and breadcrumb", () => {
    const gp = n("gp", "A.6.1.1.1.2", "Spark");
    const par = n("par", "A.6.1.1.1.2.1", "SparkLend");
    const fusedDocs = [gp, par, ...docs];
    const units = buildUnits(fusedDocs, "icd_full_params_breadcrumbs", { crumbDepth: 2 });
    const icdUnit = units.find((u) => u.anchorId === "icd")!;
    expect(icdUnit.memberIds.sort()).toEqual(["icd", "net", "params", "tok"].sort());
    expect(icdUnit.family).toBe("icd_full_params_breadcrumbs");
    // breadcrumb first
    expect(icdUnit.text.startsWith("Spark > SparkLend\n\n")).toBe(true);
    // full prose of folded members is present (not just the kv summary)
    expect(icdUnit.text).toContain(buildEmbedText(net)); // "Network\n\nEthereum Mainnet"
    expect(icdUnit.text).toContain(buildEmbedText(tok)); // "Token\n\nUSDS"
    expect(icdUnit.text).toContain(buildEmbedText(params));
    // and the structured param kv is still appended
    expect(icdUnit.text).toContain("Network: Ethereum Mainnet");
    expect(icdUnit.text).toContain("Token: USDS");
    // strictly more content than the kv-only fused policy
    const kvOnly = buildUnits(fusedDocs, "icd_params_breadcrumbs", { crumbDepth: 2 }).find((u) => u.anchorId === "icd")!;
    expect(icdUnit.text.length).toBeGreaterThan(kvOnly.text.length);
  });

  it("icd_params over-cap splits rather than dropping members", () => {
    const units = buildUnits(docs, "icd_params", { cap: 2 });
    const folded = foldedIds(units);
    // Every param leaf still appears as an anchor or a member.
    const covered = new Set(units.flatMap((u) => u.memberIds));
    expect(covered.has("net")).toBe(true);
    expect(covered.has("tok")).toBe(true);
    expect(units.every((u) => u.memberIds.length <= 2 || u.memberIds.length === 1)).toBe(true);
    expect(folded.has("opd")).toBe(false);
  });

  it("directory_direct combines a directory with its direct children", () => {
    const units = buildUnits(docs, "directory_direct");
    const dir = units.find((u) => u.anchorId === "params");
    expect(dir).toBeDefined();
    expect(dir!.memberIds.sort()).toEqual(["net", "params", "tok"].sort());
    expect(dir!.text).toContain("Network:");
  });

  it("breadcrumbs prepends non-generic ancestor titles without folding", () => {
    const units = buildUnits(docs, "breadcrumbs");
    expect(foldedIds(units).size).toBe(0);
    const netU = units.find((u) => u.anchorId === "net")!;
    expect(netU.text).toContain("Spark Foo Instance Configuration Document");
    expect(netU.text).toContain("Network");
  });

  it("hub_stubs folds a Primitive Hub with its direct directory stubs only", () => {
    const hub = n("hub", "A.6.1", "Foo Primitive Hub Document");
    const act = n("act", "A.6.1.1", "Activation");
    const inst = n("inst", "A.6.1.2", "Active Instances Directory");
    const deep = n("deep", "A.6.1.2.1", "Some Instance Configuration Document");
    const units = buildUnits([hub, act, inst, deep], "hub_stubs");
    const u = units.find((x) => x.anchorId === "hub")!;
    expect(u.memberIds.sort()).toEqual(["act", "hub", "inst"].sort());
    expect(foldedIds(units).has("deep")).toBe(false);
  });

  it("directory_descendants folds a small forest and skips hubs", () => {
    const hub = n("hub", "A.6.1", "Foo Primitive Hub Document", "The documents herein define the primitive.");
    const dir = n("dir", "A.6.1.1", "Active Instances Directory", "The documents herein contain the instances.");
    const icd = n("icd", "A.6.1.1.1", "Foo Instance Configuration Document", "x");
    const units = buildUnits([hub, dir, icd], "directory_descendants");
    expect(units.find((u) => u.anchorId === "hub")!.memberIds).toEqual(["hub"]);
    expect(units.find((u) => u.anchorId === "dir")!.memberIds.sort()).toEqual(["dir", "icd"].sort());
  });
});

describe("doc_no vs parentId past heading depth 6", () => {
  it("still nests an ICD leaf under its ICD via doc_no when parentId points at the depth-5 ancestor", () => {
    const icd = n("icd", "A.6.1.1.1.2.1.1.1", "Foo Instance Configuration Document");
    const net = n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet");
    icd.depth = 6;
    net.depth = 6;
    net.parentId = "depth5-not-the-icd";
    expect(net.parentId).not.toBe(icd.id);
    expect(isDocNoDescendant(net.doc_no, icd.doc_no)).toBe(true);
    const out = rewriteSemanticHit(
      "network",
      "icd",
      ["icd", "net"],
      [{ id: "net", doc_no: net.doc_no }],
      new Map([["icd", icd], ["net", net]]),
    );
    expect(out.id).toBe("net");
  });
});

describe("DIRECTORY_RE / hub / cap constants", () => {
  it("recognises directory boilerplate and hub titles", () => {
    expect(DIRECTORY_RE.test("The documents herein define the parameters.")).toBe(true);
    expect(DIRECTORY_RE.test("Ethereum Mainnet")).toBe(false);
    expect(HUB_TITLE_RE.test("Spark Distribution Reward Primitive Hub Document")).toBe(true);
    expect(CHUNK_ROOT_MAX).toBe(200);
  });
});

describe("breadcrumb strategies", () => {
  // root -> leaf. A, B are outermost (agent/scope), E is the immediate parent.
  const chain = ["A", "B", "C", "D", "E"];
  // "C" is the rare/informative name here; A and D are boilerplate seen everywhere.
  const freq = new Map([["A", 400], ["B", 50], ["C", 2], ["D", 900], ["E", 30]]);

  it("parses every documented strategy name", () => {
    for (const s of CRUMB_STRATEGIES) expect(() => parseCrumbStrategy(s)).not.toThrow();
    expect(parseCrumbStrategy("full")).toEqual({ kind: "full" });
    expect(parseCrumbStrategy("nearest:3")).toEqual({ kind: "nearest", n: 3 });
    expect(parseCrumbStrategy("root:2+nearest:3")).toEqual({ kind: "rootNearest", m: 2, n: 3 });
    expect(parseCrumbStrategy("distinct:3")).toEqual({ kind: "distinct", n: 3 });
  });

  it("throws on an unknown strategy rather than silently falling back", () => {
    // A typo'd strategy that quietly became "full" would invalidate a whole eval arm.
    expect(() => parseCrumbStrategy("nearest")).toThrow(/unknown crumb strategy/);
    expect(() => parseCrumbStrategy("top:2")).toThrow(/unknown crumb strategy/);
  });

  it("nearest:N keeps the N closest ancestors", () => {
    expect(selectCrumbs(chain, parseCrumbStrategy("nearest:2"))).toEqual(["D", "E"]);
    expect(selectCrumbs(chain, parseCrumbStrategy("nearest:4"))).toEqual(["B", "C", "D", "E"]);
  });

  it("root:M+nearest:N keeps the outermost M and the closest N", () => {
    expect(selectCrumbs(chain, parseCrumbStrategy("root:1+nearest:2"))).toEqual(["A", "D", "E"]);
    expect(selectCrumbs(chain, parseCrumbStrategy("root:2+nearest:3"))).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("distinct:N keeps the rarest names but restores chain order", () => {
    // Rarest three are C(2), E(30), B(50) — emitted B > C > E, not rarity order,
    // so the crumb still reads root -> leaf.
    expect(selectCrumbs(chain, parseCrumbStrategy("distinct:3"), freq)).toEqual(["B", "C", "E"]);
  });

  it("never expands a chain that is already shorter than the budget", () => {
    const short = ["A", "B"];
    for (const s of CRUMB_STRATEGIES) {
      expect(selectCrumbs(short, parseCrumbStrategy(s), freq)).toEqual(short);
    }
    expect(selectCrumbs([], parseCrumbStrategy("nearest:2"))).toEqual([]);
  });

  it("parses the raw: prefix and the agent+distinct form", () => {
    expect(parseCrumbStrategy("raw:full")).toEqual({ kind: "full", raw: true });
    expect(parseCrumbStrategy("raw:distinct:3")).toEqual({ kind: "distinct", n: 3, raw: true });
    expect(parseCrumbStrategy("raw:agent+distinct:3")).toEqual({ kind: "agentDistinct", n: 3, raw: true });
    // Without raw: the plan carries no flag at all, so old behaviour is bit-identical.
    expect(parseCrumbStrategy("distinct:3")).toEqual({ kind: "distinct", n: 3 });
  });

  it("distinct:N ranks by how many docs sit UNDER a name, not how many carry it", () => {
    // The inversion this guards: a scope title is ONE document but the ancestor of
    // thousands. Ranked by doc-count it looks rare and gets kept; ranked by
    // descendants it is correctly discarded as carrying no information.
    const chainRaw = ["The Agent Scope", "Spark", "Genesis Primitives", "Completed Instances"];
    const asContext = new Map([
      ["The Agent Scope", 7931],
      ["Spark", 2441],
      ["Genesis Primitives", 783],
      ["Completed Instances", 116],
    ]);
    expect(selectCrumbs(chainRaw, parseCrumbStrategy("raw:distinct:3"), asContext)).toEqual([
      "Spark",
      "Genesis Primitives",
      "Completed Instances",
    ]);
  });

  it("agent+distinct pins the agent that pure rarity would drop", () => {
    // Spark (2441) is "commoner" than Genesis Primitives (783), so distinct:2 drops
    // it — but the agent is the main cross-agent discriminator, so it must survive.
    const chainRaw = ["The Agent Scope", "Spark", "Genesis Primitives", "Completed Instances"];
    const asContext = new Map([
      ["The Agent Scope", 7931],
      ["Spark", 2441],
      ["Genesis Primitives", 783],
      ["Completed Instances", 116],
    ]);
    expect(selectCrumbs(chainRaw, parseCrumbStrategy("raw:distinct:2"), asContext)).not.toContain("Spark");
    const pinned = ["Spark"]; // what crumbPrefix supplies: first NON-generic ancestor
    expect(selectCrumbs(chainRaw, parseCrumbStrategy("raw:agent+distinct:2"), asContext, pinned)).toEqual([
      "Spark",
      "Genesis Primitives",
      "Completed Instances",
    ]);
  });

  it("crumbStrategy reproduces the older crumbDepth/crumbRoot spellings", () => {
    const gp = n("gp", "A.6.1.1.1.2", "Spark");
    const par = n("par", "A.6.1.1.1.2.1", "SparkLend");
    const icd = n("icd2", "A.6.1.1.1.2.1.1", "Spark Foo Instance Configuration Document", "The documents herein define this instance.");
    const params = n("p2", "A.6.1.1.1.2.1.1.1", "Parameters", "The documents herein define the parameters.");
    const net2 = n("n2", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet");
    const ds = [gp, par, icd, params, net2];
    const viaDepth = buildUnits(ds, "icd_params_breadcrumbs", { crumbDepth: 2 });
    const viaStrategy = buildUnits(ds, "icd_params_breadcrumbs", { crumbStrategy: "nearest:2" });
    const a = viaDepth.find((u) => u.anchorId === "icd2")!;
    const b = viaStrategy.find((u) => u.anchorId === "icd2")!;
    expect(b.text).toBe(a.text);
    expect(b.hash).toBe(a.hash);
  });

  it("prefers the semantic scorer over term overlap when member vectors exist", () => {
    // The measured failure: "which chain does X run on" scores "Off-chain Operational
    // Parameters" highest on term overlap ("chain" is literally in the title) while the
    // answer is "Network". A semantic score fixes it.
    const anchor = n("a", "A.1", "Spark Foo Instance Configuration Document");
    const offchain = n("off", "A.1.1", "Off-chain Operational Parameters", "Some prose.");
    const network = n("net", "A.1.2", "Network", "Ethereum Mainnet");
    const members = [anchor, offchain, network];
    // Lexical alone gets it wrong.
    expect(pickLeaf("which chain does Spark Foo run on", members, anchor).node.id).toBe("off");
    // With vectors, the right leaf wins.
    const sem = (id: string) => ({ off: 0.41, net: 0.83, a: 0.5 })[id as "off" | "net" | "a"];
    const picked = pickLeaf("which chain does Spark Foo run on", members, anchor, sem);
    expect(picked.node.id).toBe("net");
    expect(picked.match_scope).toBe("child");
  });

  it("falls back to term overlap when fewer than two members have vectors", () => {
    // One score is not a choice; a partial fetch must not silently decide.
    const anchor = n("a", "A.1", "Spark Foo Instance Configuration Document");
    const net = n("net", "A.1.1", "Network", "Ethereum Mainnet");
    const tok = n("tok", "A.1.2", "Token", "USDS");
    const only = (id: string) => (id === "tok" ? 0.9 : undefined);
    expect(pickLeaf("network", [anchor, net, tok], anchor, only).node.id).toBe("net");
  });

  it("lets the semantic scorer return the anchor itself", () => {
    // Query-side projection was rejected partly because it could never select the
    // anchor, yet for record-shaped groups the anchor IS often the answer.
    const anchor = n("a", "A.1", "Freezer Multisig", "The documents herein define it.");
    const addr = n("addr", "A.1.1", "Address", "0xabc");
    const sem = (id: string) => (id === "a" ? 0.9 : 0.2);
    const picked = pickLeaf("what does the freezer multisig cover", [anchor, addr], anchor, sem);
    expect(picked.node.id).toBe("a");
    expect(picked.match_scope).toBe("group");
  });
});
