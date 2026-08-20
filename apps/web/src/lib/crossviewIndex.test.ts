import { describe, it, expect } from "vitest";
import { extractHeadings } from "./crossviewHeadings";
import { parseCrossViewIndex, groupRefSlug, groupTargetsForDisplay } from "./crossviewIndex";

const RAW = `# Doc

### Lifecycle concepts (the primitive machine)

**Lifecycle 1 · Primitive**

body

### Normative & instrument concepts

**Norms 1 · Duties**

body

**Instruments 1 · Ecosystem Accords**

body

### Programs & economic machinery (deep-dive merge)

**Economics 1 · The four reward programs**

body

### II.7 Topics (A–Z → section)

Intro prose, ignored by the parser.

:::index
- Accords (Ecosystem) → Instruments 1
- Staking → Economics 3/Economics 4
- Payment lists → Registries 1 (empty)
- Policies/Rules → Norms 1–9
- Agent Artifacts → Lifecycle (II.4)
- Agent Tokens → Economics 1/A.4.5
- Rates (SSR/DSR/stUSDS) → Economics 3
:::endindex

## Part III — Distinctions
`;

describe("parseCrossViewIndex", () => {
  const headings = extractHeadings(RAW);
  const entries = parseCrossViewIndex(RAW, headings);
  const byTopic = (topic: string) => entries.find((e) => e.topic === topic);

  it("parses a plain single-target entry", () => {
    const e = byTopic("Accords (Ecosystem)");
    expect(e).toBeDefined();
    expect(e!.targets).toEqual([{ label: "Instruments 1", slug: "instruments-1", kind: "unit" }]);
  });

  it("parses a multi-target entry (both targets kept, both resolved)", () => {
    const e = byTopic("Staking");
    expect(e!.targets).toEqual([
      { label: "Economics 3", slug: "economics-3", kind: "unit" },
      { label: "Economics 4", slug: "economics-4", kind: "unit" },
    ]);
  });

  it("strips a trailing parenthetical annotation before resolving the unit slug", () => {
    const e = byTopic("Payment lists");
    expect(e!.targets).toEqual([{ label: "Registries 1 (empty)", slug: "registries-1", kind: "unit" }]);
  });

  it("keeps a parenthesized, slash-containing topic name intact (the slash is topic-side, not a target separator)", () => {
    // "Rates (SSR/DSR/stUSDS) → Economics 3" — the slash lives in the topic,
    // before " → ", so it must not be treated as a multi-target separator.
    const e = entries.find((x) => x.topic.startsWith("Rates ("));
    expect(e).toBeDefined();
    expect(e!.topic).toBe("Rates (SSR/DSR/stUSDS)");
    expect(e!.targets).toEqual([{ label: "Economics 3", slug: "economics-3", kind: "unit" }]);
  });

  it("resolves a range target to its family's section heading, as one category link", () => {
    const e = byTopic("Policies/Rules");
    expect(e!.targets).toHaveLength(1);
    expect(e!.targets[0].kind).toBe("category");
    expect(e!.targets[0].label).toBe("Norms 1–9");
    expect(e!.targets[0].slug).toBe("normative-instrument-concepts");
  });

  it("resolves a bare-family-plus-legacy-code target to its section heading as a category", () => {
    const e = byTopic("Agent Artifacts");
    expect(e!.targets[0]).toEqual({
      label: "Lifecycle (II.4)",
      slug: "lifecycle-concepts-the-primitive-machine",
      kind: "category",
    });
  });

  it("leaves a bare doc_no target unresolved while its sibling target still resolves", () => {
    const e = byTopic("Agent Tokens");
    expect(e!.targets).toEqual([
      { label: "Economics 1", slug: "economics-1", kind: "unit" },
      { label: "A.4.5", slug: null, kind: "unresolved" },
    ]);
  });
});

describe("groupRefSlug", () => {
  it("matches the unit-opener id scheme (lowercase, hyphenated)", () => {
    expect(groupRefSlug("Instruments", "5")).toBe("instruments-5");
    expect(groupRefSlug("Economics", "9")).toBe("economics-9");
  });
});

describe("groupTargetsForDisplay", () => {
  it("compacts same-family multi-unit targets", () => {
    const grouped = groupTargetsForDisplay([
      { label: "Economics 3", slug: "economics-3", kind: "unit" },
      { label: "Economics 4", slug: "economics-4", kind: "unit" },
    ]);
    expect(grouped).toEqual({
      mode: "compact",
      family: "Economics",
      nums: [
        { num: "3", slug: "economics-3" },
        { num: "4", slug: "economics-4" },
      ],
    });
  });

  it("falls back to full rendering for mixed-family targets", () => {
    const grouped = groupTargetsForDisplay([
      { label: "Instruments 3", slug: "instruments-3", kind: "unit" },
      { label: "Lifecycle 6", slug: "lifecycle-6", kind: "unit" },
    ]);
    expect(grouped.mode).toBe("full");
  });

  it("does not compact a single target", () => {
    const grouped = groupTargetsForDisplay([{ label: "Instruments 1", slug: "instruments-1", kind: "unit" }]);
    expect(grouped.mode).toBe("full");
  });
});
