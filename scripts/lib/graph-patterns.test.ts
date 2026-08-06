import { describe, it, expect } from "vitest";
import {
  resolveAliasedEntity,
  buildNameIndex,
  slugify,
  isPrimeAgent,
  isExecutorAgent,
  isFacilitatorDoc,
  isGovOpsDoc,
  isActiveData,
  isAnnotation,
  isEcosystemAccord,
  isPartyDetails,
  isGrantDoc,
  isICDLocation,
  isICD,
  isGlobalActivationStatus,
  UUID_LINK_RE,
  extractRP,
  extractAllRP,
  extractAutomation,
  isDescriptiveRP,
  rpRoleAndName,
  parseNameList,
  extractListItems,
  ancestorByStripping,
  primitiveRootFor,
  extractAssignment,
} from "./graph-patterns.mjs";

function entity(slug: string, name: string) {
  return { id: `id-${slug}`, slug, name, entity_type: "ecosystem_actor", subtype: null, defining_doc_id: null, is_active: 1, meta: null };
}

function doc(doc_no: string, title = "Doc", content = "", type = "Core") {
  return { id: `id-${doc_no}`, doc_no, title, type, content };
}

describe("resolveAliasedEntity", () => {
  it("returns the exact name/slug match when one exists", () => {
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Spark")?.slug).toBe("spark");
  });

  it("falls back to an unambiguous word-boundary prefix match", () => {
    const entityMap = new Map([["redline-facilitation-group", entity("redline-facilitation-group", "Redline Facilitation Group")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Redline")?.slug).toBe("redline-facilitation-group");
  });

  it("does not match a non-word-boundary substring", () => {
    const entityMap = new Map([["redline-facilitation-group", entity("redline-facilitation-group", "Redline Facilitation Group")]]);
    const nameIndex = buildNameIndex(entityMap);
    // "Red" is a substring but not a whole-word prefix ("Red " != "Redl...").
    expect(resolveAliasedEntity(nameIndex, entityMap, "Red")).toBeNull();
  });

  it("refuses to guess when the prefix is ambiguous", () => {
    // Slugs deliberately don't collapse to "corefacilitator" (unlike a real
    // slugify("Core Facilitator Alpha")) so the ambiguity is decided by the
    // prefix scan, not an accidental exact slug hit.
    const entityMap = new Map([
      ["cfa", entity("cfa", "Core Facilitator Alpha")],
      ["cfb", entity("cfb", "Core Facilitator Beta")],
    ]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Core Facilitator")).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Grove")).toBeNull();
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugify("Spark Foundation")).toBe("spark-foundation");
    expect(slugify("SPK Company Ltd.")).toBe("spk-company-ltd");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  Core Council Buffer  ")).toBe("core-council-buffer");
    expect(slugify("(Osero)")).toBe("osero");
  });
});

describe("doc_no / title predicates", () => {
  it("isPrimeAgent matches direct children of A.6.1.1 only", () => {
    expect(isPrimeAgent(doc("A.6.1.1.1"))).toBe(true); // Spark
    expect(isPrimeAgent(doc("A.6.1.1.1.2"))).toBe(false);
  });

  it("isExecutorAgent matches direct children of A.6.1.2 only", () => {
    expect(isExecutorAgent(doc("A.6.1.2.1"))).toBe(true);
    expect(isExecutorAgent(doc("A.6.1.2.1.1"))).toBe(false);
  });

  it("isFacilitatorDoc / isGovOpsDoc match the .1 / .2 children of an executor", () => {
    expect(isFacilitatorDoc(doc("A.6.1.2.1.1"))).toBe(true);
    expect(isFacilitatorDoc(doc("A.6.1.2.1.2"))).toBe(false);
    expect(isGovOpsDoc(doc("A.6.1.2.1.2"))).toBe(true);
    expect(isGovOpsDoc(doc("A.6.1.2.1.1"))).toBe(false);
  });

  it("isActiveData matches the .0.6.N structural suffix", () => {
    expect(isActiveData(doc("A.1.1.3.1.0.6.1"))).toBe(true);
    expect(isActiveData(doc("A.1.1.3.1"))).toBe(false);
  });

  it("isAnnotation matches .0.3.N, .0.4.N, and .N.varN suffixes", () => {
    expect(isAnnotation(doc("A.1.12.1.2.0.3.1"))).toBe(true); // Annotation
    expect(isAnnotation(doc("A.1.4.5.0.4.1"))).toBe(true); // Action Tenet
    expect(isAnnotation(doc("A.1.4.5.0.4.1.1.1.var1"))).toBe(true); // Scenario Variation
    expect(isAnnotation(doc("A.1.1.1"))).toBe(false);
  });

  it("isEcosystemAccord matches direct children of A.2.8.2 only", () => {
    expect(isEcosystemAccord(doc("A.2.8.2.2"))).toBe(true);
    expect(isEcosystemAccord(doc("A.2.8.2.2.1"))).toBe(false);
  });

  it("isPartyDetails matches the party-details doc_no shape", () => {
    expect(isPartyDetails(doc("A.2.8.2.2.1.1.2"))).toBe(true);
    expect(isPartyDetails(doc("A.2.8.2.2.1.1"))).toBe(false);
  });

  it("isGrantDoc matches the A.2.13.1.X.Y grant doc_no shape", () => {
    expect(isGrantDoc(doc("A.2.13.1.1.1"))).toBe(true); // August 2025 Grant
    expect(isGrantDoc(doc("A.2.13.1.1"))).toBe(false);
  });

  it("isGlobalActivationStatus matches by title regardless of doc_no", () => {
    expect(isGlobalActivationStatus(doc("A.6.1.1.1.2.5.1.1", "Global Activation Status"))).toBe(true);
    expect(isGlobalActivationStatus(doc("A.6.1.1.1.2.5.1.1", "Active Instances Directory"))).toBe(false);
  });

  it("isICDLocation matches by title suffix", () => {
    expect(isICDLocation(doc("A.1", "Spark MetaMorpho Instance Configuration Document Location"))).toBe(true);
    expect(isICDLocation(doc("A.1", "Spark MetaMorpho Instance Configuration Document"))).toBe(false);
  });

  it("isICDLocation falls back to content when the title is misnamed (missing the Location suffix)", () => {
    expect(
      isICDLocation(
        doc("A.1", "Spark MetaMorpho Instance Configuration Document", "This Instance's associated Instance Configuration Document is located at [uuid link]."),
      ),
    ).toBe(true);
    // Typographic apostrophe variant.
    expect(
      isICDLocation(
        doc("A.1", "Spark MetaMorpho Instance Configuration Document", "This Instance’s associated Instance Configuration Document is located at [uuid link]."),
      ),
    ).toBe(true);
  });

  it("isICD matches ICDs by title but excludes Location docs", () => {
    expect(isICD(doc("A.1", "Spark MetaMorpho Instance Configuration Document"))).toBe(true);
    expect(isICD(doc("A.1", "Spark MetaMorpho Instance Configuration Document Location"))).toBe(false);
    expect(isICD(doc("A.1", "Active Instances Directory"))).toBe(false);
  });
});

describe("UUID_LINK_RE", () => {
  it("matches a markdown UUID citation link and captures text + uuid", () => {
    const content = "See [A.2.2 - Sky Primitives](8135523a-dd5f-482d-b522-ec4227746eaf) for details.";
    UUID_LINK_RE.lastIndex = 0;
    const m = UUID_LINK_RE.exec(content);
    expect(m?.[1]).toBe("A.2.2 - Sky Primitives");
    expect(m?.[2]).toBe("8135523a-dd5f-482d-b522-ec4227746eaf");
  });

  it("does not match a link whose target isn't UUID-shaped", () => {
    const content = "See [external](https://example.com) for details.";
    UUID_LINK_RE.lastIndex = 0;
    expect(UUID_LINK_RE.exec(content)).toBeNull();
  });
});

describe("extractRP", () => {
  it("extracts the 'is' phrasing", () => {
    // Active Data Controller shape.
    expect(extractRP("The Responsible Party is Operational GovOps.")).toBe("Operational GovOps");
  });

  it("extracts the colon-field phrasing", () => {
    expect(extractRP("Responsible Party: Core Facilitator")).toBe("Core Facilitator");
  });

  it("returns null when no RP declaration is present", () => {
    expect(extractRP("This section contains no such declaration.")).toBeNull();
    expect(extractRP(null)).toBeNull();
  });
});

describe("extractAllRP", () => {
  it("collects every 'Responsible Party:' occurrence in a multi-step doc", () => {
    const content = "Step 1.\nResponsible Party: Operational GovOps\n\nStep 2.\nResponsible Parties: Core Facilitator";
    expect(extractAllRP(content)).toEqual(["Operational GovOps", "Core Facilitator"]);
  });

  it("returns an empty array when there are none", () => {
    expect(extractAllRP("No declarations here.")).toEqual([]);
    expect(extractAllRP(undefined)).toEqual([]);
  });
});

describe("extractAutomation", () => {
  it("strips a positive automation bracket and flags automated=true", () => {
    expect(extractAutomation("Operational GovOps [automated]")).toEqual({
      clean: "Operational GovOps",
      automated: true,
    });
  });

  it("strips a negated automation bracket and flags automated=false", () => {
    expect(extractAutomation("Operational GovOps [if not automated]")).toEqual({
      clean: "Operational GovOps",
      automated: false,
    });
  });

  it("leaves unrelated brackets untouched", () => {
    expect(extractAutomation("Operational GovOps [see note]")).toEqual({
      clean: "Operational GovOps [see note]",
      automated: false,
    });
  });
});

describe("isDescriptiveRP", () => {
  it("flags lowercase-leading phrases as descriptive, not a proper-noun entity", () => {
    expect(isDescriptiveRP("entity to which the registration pertains")).toBe(true);
  });

  it("does not flag a proper-noun name", () => {
    expect(isDescriptiveRP("Soter Labs")).toBe(false);
  });
});

describe("rpRoleAndName", () => {
  it("splits a role-prefixed value into role key + name", () => {
    expect(rpRoleAndName("Operational GovOps Soter Labs")).toEqual({
      role: "operational_govops",
      name: "Soter Labs",
    });
  });

  it("normalizes the spaceless 'CoreGovOps' spelling before matching", () => {
    expect(rpRoleAndName("CoreGovOps Atlas Axis")).toEqual({ role: "core_govops", name: "Atlas Axis" });
  });

  it("returns a null role when the value is a bare name with no role prefix", () => {
    expect(rpRoleAndName("Soter Labs")).toEqual({ role: null, name: "Soter Labs" });
  });
});

describe("parseNameList", () => {
  it("splits a comma/and list and strips leading articles", () => {
    expect(parseNameList("the Spark Prime Agent, and Phoenix Labs")).toEqual(["Spark Prime Agent", "Phoenix Labs"]);
  });

  it("splits an Oxford-comma-less 'X and Y' pair", () => {
    expect(parseNameList("Grove Prime Agent and Grove Foundation")).toEqual(["Grove Prime Agent", "Grove Foundation"]);
  });

  it("drops empty segments", () => {
    expect(parseNameList("Amatsu Executor Agent")).toEqual(["Amatsu Executor Agent"]);
  });
});

describe("extractListItems", () => {
  it("extracts bullet lines and strips a leading Recipient: label", () => {
    const content = "Members:\n- Redline Facilitation Group\n- Recipient: Atlas Axis\nSome trailing prose.";
    expect(extractListItems(content)).toEqual(["Redline Facilitation Group", "Atlas Axis"]);
  });

  it("returns an empty array for content with no bullets", () => {
    expect(extractListItems("Just a paragraph, no bullets.")).toEqual([]);
    expect(extractListItems(undefined)).toEqual([]);
  });
});

describe("ancestorByStripping", () => {
  it("strips N trailing doc_no segments and looks up the ancestor", () => {
    const docByDocNo = new Map([["A.6.1.1.1.2", doc("A.6.1.1.1.2", "Sky Primitives")]]);
    expect(ancestorByStripping(doc("A.6.1.1.1.2.5.1"), 2, docByDocNo)?.doc_no).toBe("A.6.1.1.1.2");
  });

  it("returns null when the doc_no is too short to strip N segments", () => {
    const docByDocNo = new Map();
    expect(ancestorByStripping(doc("A.1"), 2, docByDocNo)).toBeNull();
  });

  it("returns null when the stripped ancestor isn't in the map", () => {
    const docByDocNo = new Map();
    expect(ancestorByStripping(doc("A.6.1.1.1.2.5.1"), 2, docByDocNo)).toBeNull();
  });
});

describe("primitiveRootFor", () => {
  it("resolves the primitive root for a deeply nested ICD", () => {
    const root = doc("A.6.1.1.1.2.5.1", "Distribution Reward Primitive");
    const docByDocNo = new Map([[root.doc_no, root]]);
    const icd = doc("A.6.1.1.1.2.5.1.2.3.1.1", "Reward Code");
    expect(primitiveRootFor(icd, docByDocNo)?.doc_no).toBe("A.6.1.1.1.2.5.1");
  });

  it("returns null when the doc_no doesn't match the primitive-root shape", () => {
    const docByDocNo = new Map();
    expect(primitiveRootFor(doc("A.2.2.5.1"), docByDocNo)).toBeNull();
  });

  it("returns null when the resolved doc's title doesn't end in 'Primitive'", () => {
    const root = doc("A.6.1.1.1.2.5.1", "Active Instances Directory");
    const docByDocNo = new Map([[root.doc_no, root]]);
    const icd = doc("A.6.1.1.1.2.5.1.2.3", "Some ICD");
    expect(primitiveRootFor(icd, docByDocNo)).toBeNull();
  });
});

describe("extractAssignment", () => {
  it("extracts the value from an 'X is the Y.' sentence", () => {
    expect(extractAssignment("The Facilitator for Amatsu is the Redline Facilitation Group.", "The Facilitator for Amatsu")).toBe(
      "Redline Facilitation Group",
    );
  });

  it("extracts the value from an 'X is Y.' sentence with no article", () => {
    expect(extractAssignment("Core GovOps for Ozone is Soter Labs.", "Core GovOps for Ozone")).toBe("Soter Labs");
  });

  it("returns null when the prefix doesn't match", () => {
    expect(extractAssignment("The Facilitator for Amatsu is Redline.", "The GovOps for Amatsu")).toBeNull();
    expect(extractAssignment(null, "The Facilitator for Amatsu")).toBeNull();
  });
});
