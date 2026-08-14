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
