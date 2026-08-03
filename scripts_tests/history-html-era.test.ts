// HTML-era threading passes (plan §4): synthetic v5 ids, backward identity
// threading, forward event emission. Pure-function fixtures.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { syntheticUuid, isSynthetic } from "../scripts/htmlhist/history-identity.mjs";
// @ts-expect-error — .mjs without types
import { threadBackward, buildEvents, seedFromMd } from "../scripts/htmlhist/history-html-era.mjs";

type Node = any;
const node = (id: string, o: Partial<Node> & { order: number }): Node => ({
  contentHash: o.contentHash ?? `h:${o.content ?? id}`,
  structuralKey: o.structuralKey ?? `k:${id}`,
  content: o.content ?? id,
  section: "S",
  doc_no: o.doc_no ?? null,
  title: o.title ?? id,
  ancestors: o.ancestors ?? [],
  order: o.order,
});

describe("synthetic v5 uuids", () => {
  it("is deterministic and version-5 (distinguishable from real v4)", () => {
    const n = node("X", { order: 0, content: "body", contentHash: "abc" });
    const a = syntheticUuid(n, "sha1");
    const b = syntheticUuid(n, "sha1");
    expect(a).toBe(b);
    expect(a[14]).toBe("5");
    expect(isSynthetic(a)).toBe(true);
  });
  it("keys to a contiguous life via firstSeenSha", () => {
    const n = node("X", { order: 0, content: "body", contentHash: "abc" });
    expect(syntheticUuid(n, "sha1")).not.toBe(syntheticUuid(n, "sha2"));
  });
  it("a real v4 uuid is not flagged synthetic", () => {
    expect(isSynthetic("4f6fda1e-7450-4065-8095-e93cb10b3a2a")).toBe(false);
  });
});

describe("seedFromMd — #117 seam classification", () => {
  const A = "alpha beta gamma delta epsilon zeta eta theta iota kappa"; // 10 words
  const B = "lambda mu nu xi omicron pi rho sigma tau upsilon";
  const md = [{ uuid: "uuid-A", content: A }, { uuid: "uuid-B", content: B }];
  // P (parent) contains both A and B; Q duplicates A's content (a merge)
  const P = { content: `${A} ${B}` }, Q = { content: A };
  const seed = seedFromMd(md, [P, Q]);

  it("a 1:1 row → kept; its row carries the real uuid", () => {
    expect(seed.seam.get("uuid-A")).toBe("kept");
    expect(seed.uuidByRow.get(P)).toBe("uuid-A");
  });
  it("an md body carved out of a parent row → split, with extracted_from", () => {
    expect(seed.seam.get("uuid-B")).toBe("split");
    expect(seed.extractedFrom.get("uuid-B")).toBe("uuid-A");
  });
  it("a duplicate row absorbed into a successor → merged_into", () => {
    expect(seed.uuidByRow.has(Q)).toBe(false);
    expect(seed.mergedInto.get(Q)).toBe("uuid-A");
  });
});

describe("seedFromMd — human overrides (plan §10.4)", () => {
  const A = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const B = "lambda mu nu xi omicron pi rho sigma tau upsilon";
  const md = [{ uuid: "uuid-A", content: A, title: "Doc A" }, { uuid: "uuid-B", content: B, title: "Doc B" }];
  const P = { content: `${A} ${B}`, title: "P" }, Q = { content: A, title: "Q" };

  it("forces a md uuid onto the chosen row, overriding the auto seed", () => {
    const seed = seedFromMd(md, [P, Q], { overrides: new Map([["uuid-B", Q]]) });
    expect(seed.uuidByRow.get(Q)).toBe("uuid-B"); // Q auto-merged into uuid-A; the override wins
    expect(seed.seam.get("uuid-B")).toBe("kept");
    expect(seed.overrideCount).toBe(1);
  });

  it("marks a md doc 'created' when the human picks none", () => {
    const seed = seedFromMd(md, [P, Q], { overrides: new Map([["uuid-A", null]]) });
    expect([...seed.uuidByRow.values()]).not.toContain("uuid-A");
    expect(seed.seam.get("uuid-A")).toBe("created");
  });

  it("a doc displaced by an override is untraced, not created", () => {
    // The override hands P to uuid-B, so uuid-A loses the row it had auto-claimed.
    // Losing a claim says nothing about where uuid-A came from.
    const seed = seedFromMd(md, [P, Q], { overrides: new Map([["uuid-B", P]]) });
    expect(seed.seam.get("uuid-A")).toBe("untraced");
  });
});

// A doc whose whole body is one word ("`Completed`" — the ICD parameter leaves) makes no
// 8-word shingle, so the seed can neither match nor rule out a predecessor for it. It used
// to fall through as `created`. See scripts/htmlhist/seed-positional.mjs.
describe("seedFromMd — tier S2: zero-shingle docs (seed-positional.mjs)", () => {
  const A = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const B = "lambda mu nu xi omicron pi rho sigma tau upsilon";
  const anchorMd = [{ uuid: "uuid-A", content: A, title: "Doc A" }, { uuid: "uuid-B", content: B, title: "Doc B" }];
  const P = { content: A, title: "Doc A" }, Q = { content: B, title: "Doc B" };
  const gas = (uuid: string, body: string) => ({ uuid, content: body, title: "Global Activation Status" });
  const row = (body: string) => ({ content: body, title: "Global Activation Status" });

  it("threads a short doc sitting in the same gap as its row", () => {
    const md = [anchorMd[0], gas("uuid-G", "`Completed`"), anchorMd[1]];
    const R = row("Completed");
    const seed = seedFromMd(md, [P, R, Q]);
    expect(seed.uuidByRow.get(R)).toBe("uuid-G");
    expect(seed.seam.get("uuid-G")).toBe("kept");
    expect(seed.positionalUuids.has("uuid-G")).toBe(true);
    expect(seed.seam.get("uuid-A")).toBe("kept"); // the anchors are untouched
  });

  it("keeps k-th ↔ k-th order inside a gap", () => {
    const md = [anchorMd[0], gas("uuid-1", "`Active`"), gas("uuid-2", "`Inactive`"), anchorMd[1]];
    const R1 = row("Active"), R2 = row("Inactive");
    const seed = seedFromMd(md, [P, R1, R2, Q]);
    expect(seed.uuidByRow.get(R1)).toBe("uuid-1");
    expect(seed.uuidByRow.get(R2)).toBe("uuid-2");
  });

  it("leaves an unequal bucket untraced rather than guessing", () => {
    // Two identical candidate rows for one md doc: the gap can't say which, so neither.
    const md = [anchorMd[0], gas("uuid-G", "`Active`"), anchorMd[1]];
    const R1 = row("Active"), R2 = row("Active");
    const seed = seedFromMd(md, [P, R1, R2, Q]);
    expect(seed.seam.get("uuid-G")).toBe("untraced");
    expect(seed.uuidByRow.has(R1)).toBe(false);
    expect(seed.uuidByRow.has(R2)).toBe(false);
  });

  it("does not reach across an anchor into a different gap", () => {
    // The row sits AFTER the second anchor, the md doc BEFORE it — different gaps.
    const md = [anchorMd[0], gas("uuid-G", "`Completed`"), anchorMd[1]];
    const R = row("Completed");
    const seed = seedFromMd(md, [P, Q, R]);
    expect(seed.seam.get("uuid-G")).toBe("untraced");
  });

  it("an unmatched doc with a normal-length body is untraced, not created", () => {
    const md = [{ uuid: "uuid-N", content: "one two three four five six seven eight nine", title: "New" }];
    const seed = seedFromMd(md, [P]);
    expect(seed.seam.get("uuid-N")).toBe("untraced");
  });
});

describe("threadBackward — human overrides (plan §10.4)", () => {
  it("forces the chosen older row to inherit the newer identity", () => {
    const N1 = node("N1", { order: 0, content: "n1 body" });
    const N2 = node("N2", { order: 1, content: "n2 body" });
    const O1 = node("O1", { order: 0, content: "n1 body" }); // would auto-match N1
    const O2 = node("O2", { order: 1, content: "n2 body" }); // would auto-match N2
    const commits = [{ sha: "s0", seq: 0, nodes: [O1, O2] }, { sha: "s1", seq: 1, nodes: [N1, N2] }];
    const seed = new Map<any, string>([[N1, "uuid-1"], [N2, "uuid-2"]]);
    const res = threadBackward(commits, { seed, overrides: new Map([[N2, O1]]) });
    expect(O1.uuid).toBe("uuid-2"); // overridden: O1 is N2's previous version, not N1's
    expect(isSynthetic(O2.uuid)).toBe(true); // its auto pairing was suppressed → death
    expect(res.appliedOverrides).toBe(1);
  });
});

describe("threadBackward — Pass A", () => {
  // seq 0: [A,B]   seq 1: [A,B,C]   seq 2: [A, B'] (C died, B modified)
  const c0 = { sha: "s0", seq: 0, nodes: [node("A", { order: 0, doc_no: "A.1" }), node("B", { order: 1 })] };
  const c1 = { sha: "s1", seq: 1, nodes: [node("A", { order: 0, doc_no: "A.1" }), node("B", { order: 1 }), node("C", { order: 2 })] };
  const aTop = node("A", { order: 0, doc_no: "A.2" });            // A renumbered, content unchanged
  const bTop = node("B", { order: 1, content: "B2", contentHash: "h:B2" }); // B modified, same key k:B
  const c2 = { sha: "s2", seq: 2, nodes: [aTop, bTop] };
  const commits = [c0, c1, c2];
  const seed = new Map<any, string>([[aTop, "uuid-A"], [bTop, "uuid-B"]]);

  const res = threadBackward(commits, { seed });

  it("threads real uuids all the way back to the oldest commit", () => {
    expect(c0.nodes[0].uuid).toBe("uuid-A"); // A at seq 0
    expect(c0.nodes[1].uuid).toBe("uuid-B"); // B at seq 0
  });
  it("mints a synthetic v5 id for a mid-era death (C)", () => {
    const cNode = c1.nodes[2];
    expect(isSynthetic(cNode.uuid)).toBe(true);
    expect(res.synthetics.some((s: any) => s.uuid === cNode.uuid && s.kind === "death")).toBe(true);
  });
  it("records an orphan entry (death/birth) per hop", () => {
    expect(res.orphansByCommit.length).toBe(2); // two backward hops
  });
});

describe("buildEvents — Pass B", () => {
  const c0 = { sha: "s0", seq: 0, nodes: [node("A", { order: 0, doc_no: "A.1" }), node("B", { order: 1 })] };
  const c1 = { sha: "s1", seq: 1, nodes: [node("A", { order: 0, doc_no: "A.1" }), node("B", { order: 1 }), node("C", { order: 2 })] };
  const aTop = node("A", { order: 0, doc_no: "A.2" });
  const bTop = node("B", { order: 1, content: "B2", contentHash: "h:B2" });
  const c2 = { sha: "s2", seq: 2, nodes: [aTop, bTop] };
  const commits = [c0, c1, c2];
  threadBackward(commits, { seed: new Map([[aTop, "uuid-A"], [bTop, "uuid-B"]]) });
  const events = buildEvents(commits, { lineDiff: (a: string, b: string) => `${a}→${b}` });
  const of = (uuid: string) => events.filter((e: any) => e.uuid === uuid);

  it("stamps the additive `era` field on every event", () => {
    expect(events.every((e: any) => e.era === "html")).toBe(true);
  });
  it("emits added once, at first appearance", () => {
    expect(of("uuid-A").filter((e: any) => e.type === "added").length).toBe(1);
  });
  it("emits modified with a diff when content changes", () => {
    const mod = of("uuid-B").find((e: any) => e.type === "modified");
    expect(mod).toBeTruthy();
    expect(mod.diff).toBe("B→B2");
  });
  it("emits moved (doc_no change) as movedFrom→movedTo with moveKind", () => {
    const mv = of("uuid-A").find((e: any) => e.type === "moved");
    expect(mv).toMatchObject({ movedFrom: "A.1", movedTo: "A.2", moveKind: "doc_no" });
  });
  it("a mid-era death gets added + removed; its added is flagged synthetic", () => {
    const cNode = c1.nodes[2];
    const evs = of(cNode.uuid);
    expect(evs.find((e: any) => e.type === "added").synthetic).toBe(true);
    expect(evs.some((e: any) => e.type === "removed")).toBe(true);
  });
});
