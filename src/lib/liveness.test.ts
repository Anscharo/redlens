import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types";
import { buildLivenessMap } from "./liveness";

let order = 0;
const mk = (doc_no: string, title: string, content: string, id?: string): AtlasNode => ({
  id: id ?? `id-${doc_no}`,
  doc_no,
  title,
  type: "Core",
  depth: 1,
  parentId: null,
  content,
  order: order++,
  addressRefs: [],
});

const toMap = (nodes: AtlasNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe("scaffold — registry-liveness census path", () => {
  it("tags an empty registry (bare pointer sentence) and leaves a live one out of the map", () => {
    const nodes = [
      mk("A.9.1", "List Of Empty Registry", "The current Foos are:"),
      mk("A.9.2", "List Of Live Registry", "The Foos are:\n\n- Foo One\n- Foo Two"),
    ];
    const liveness = buildLivenessMap(toMap(nodes));
    expect(liveness.get("id-A.9.1")).toBe("scaffold");
    expect(liveness.has("id-A.9.2")).toBe(false);
  });
});

describe("scaffold — empty-scaffolding census path", () => {
  it("tags an empty status-bucket directory and leaves a populated one out of the map", () => {
    const nodes = [
      mk("A.9.3", "Active Instances Directory", "x"),
      mk("A.9.4", "Completed Invocations", "x"),
      mk("A.9.4.1", "An Invocation", "x"),
    ];
    const liveness = buildLivenessMap(toMap(nodes));
    expect(liveness.get("id-A.9.3")).toBe("scaffold");
    expect(liveness.has("id-A.9.4")).toBe(false);
  });
});

describe("placeholder — future/later iteration phrase", () => {
  it("tags a doc whose entire content defers to a future iteration", () => {
    const nodes = [mk("A.9.5", "Deferred Rule", "This process will be specified in a future iteration of the Atlas.")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.5")).toBe("placeholder");
  });

  it("also matches the 'later iterations' variant", () => {
    const nodes = [mk("A.0", "Atlas Preamble", "This Preamble will be further populated in later iterations of the Atlas.")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.0")).toBe("placeholder");
  });

  it("does NOT tag a substantive, settled doc that defers only a narrow sub-detail", () => {
    // Real corpus false positive this regression guards: "Core Council Allocation" —
    // a fully specified allocation rule with one deferred sub-detail at the end.
    const nodes = [
      mk(
        "A.9.6",
        "Substantive Rule With Minor Deferral",
        "Ten percent of Step 1 Capital is allocated to the Core Council, which directs these funds across governance operations and development work. This allocation funds active Core Executor Agents and Aligned Delegates without limitation. At the discretion of the Core Council, funds may be allocated to pay these recipients directly or to fund the Core Council Buffer for subsequent disbursement. The Core Council is authorized to direct grants from this allocation without a separate governance decision for each grant. The specific allocation among the components of the Core Council Allocation will be specified in a future iteration of the Atlas."
      ),
    ];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.6")).toBe(false);
  });

  it("does NOT tag a SHORT doc that states a real value and defers only a sub-detail", () => {
    // Real corpus false positive this regression guards: "Maple"
    // (A.3.2.2.1.1.1.1.3.1). The non-stub remainder is far under the 200-char
    // gate, so length alone would tag it — but it states an actual CRR, and a
    // placeholder tag here is what lets verify/absence.ts ground a false "the
    // atlas doesn't specify Maple's CRR".
    const nodes = [
      mk(
        "A.9.6.1",
        "Maple",
        "The Instance Financial CRR for Maple SyrupUSDC is 3%. The maximum exposure a Prime Agent may have to Maple SyrupUSDC will be specified in a future iteration of the Atlas."
      ),
    ];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.6.1")).toBe(false);
  });

  it("does NOT tag a kv doc where one field is specified and a sibling field is deferred", () => {
    // Real corpus false positive: the two "Inflow Rate Limits" docs — a stated
    // `maxAmount` alongside a deferred `slope`.
    const nodes = [
      mk(
        "A.9.6.2",
        "Inflow Rate Limits",
        "The inflow rate limits are:\n\n- `maxAmount`: 0\n- `slope`: This parameter will be specified in a future iteration of the Spark Artifact."
      ),
    ];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.6.2")).toBe(false);
  });

  it("still tags a short doc whose only non-stub text is a bare pointer with no value", () => {
    // The other side of the same line: a thin remainder that states nothing is
    // exactly the placeholder shape the gate is for.
    const nodes = [mk("A.9.6.3", "Slope", "The slope for this rate limit is to be determined.")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.6.3")).toBe("placeholder");
  });

  it("does NOT tag when the deferral shares a bulleted line-tree with fully-specified branches", () => {
    // Real corpus false positive this regression guards: "Sky Core Atlas Updates" —
    // one fully-specified branch plus a sibling bullet that's just "- TBD". Flattening
    // newlines before splitting would merge the whole tree into one unit and zero the
    // remainder; line-first splitting keeps the TBD bullet isolated.
    const nodes = [
      mk(
        "A.9.7",
        "Structured Update Process",
        "The documents herein are updated as the output of this process.\n\n- Case One\n    - Updated Fields\n        - Status: populate with Pending Payment\n        - Reward Period: populate with reward period\n        - Responsible Party: Core GovOps\n- Case Two\n    - TBD"
      ),
    ];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.7")).toBe(false);
  });
});

describe("placeholder — TBD phrase", () => {
  it("tags a doc whose value is a bare TBD token", () => {
    const nodes = [mk("A.9.8", "Pending Address", "The address of the Multisig is: `TBD`")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.8")).toBe("placeholder");
  });

  it("does NOT tag TBD when it's quoted as an example of a marking convention, not a real value", () => {
    const nodes = [
      mk("A.9.9", "Marking Convention", 'The Governance Point will mark any items as "TBD" or "TBC" if they require further discussion or confirmation.'),
    ];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.9")).toBe(false);
  });
});

describe("placeholder — to be defined / to be determined / not yet specified / not yet defined", () => {
  it.each([
    ["to be defined", "The exact mechanism is to be defined."],
    ["to be determined", "The exact fee is to be determined."],
    ["not yet specified", "The rate limit is not yet specified."],
    ["not yet defined", "The process is not yet defined."],
  ])("matches phrase class: %s", (_label, content) => {
    const nodes = [mk("A.9.10", "Phrase Class Doc", content)];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.10")).toBe("placeholder");
  });
});

describe("placeholder — childless empty stub", () => {
  it("tags a doc with empty content and no descendants", () => {
    const nodes = [mk("A.9.11", "Empty Leaf", "")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.11")).toBe("placeholder");
  });

  it("does NOT tag an empty doc that has descendants (a structural container, not a stub)", () => {
    const nodes = [mk("A.9.12", "Container", ""), mk("A.9.12.1", "Child", "real content")];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.12")).toBe(false);
  });
});

describe("precedence — scaffold beats placeholder", () => {
  it("tags scaffold, not placeholder, when a doc qualifies for both", () => {
    // Genuinely dual-qualifying: an empty "List Of ..." registry (census bucket
    // "empty" — no descendants, no table, no bullets) whose bare pointer sentence
    // also happens to contain a placeholder-phrase trigger (TBD).
    const nodes = [mk("A.9.13", "List Of TBD Registry", "The current Foos are: TBD")];
    expect(buildLivenessMap(toMap(nodes)).get("id-A.9.13")).toBe("scaffold");
  });
});

describe("settled docs are absent from the map", () => {
  it("does not include an ordinary, fully-specified doc", () => {
    const nodes = [mk("A.9.14", "Ordinary Doc", "This is a fully specified, settled rule with no deferrals.")];
    expect(buildLivenessMap(toMap(nodes)).has("id-A.9.14")).toBe(false);
  });
});

describe("determinism", () => {
  it("produces the same entries regardless of input insertion order", () => {
    const nodes = [
      mk("A.9.15", "List Of Empty Registry", "The current Foos are:"),
      mk("A.9.16", "Deferred Rule", "This will be specified in a future iteration of the Atlas."),
      mk("A.9.17", "Ordinary Doc", "Settled content."),
    ];
    const norm = (m: Map<string, string>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    const forward = buildLivenessMap(toMap(nodes));
    const reversed = buildLivenessMap(toMap([...nodes].reverse()));
    expect(norm(reversed)).toEqual(norm(forward));
  });
});
