import { describe, it, expect } from "bun:test";
import type { AtlasNode } from "../../src/types.ts";
import { generateRetrievalQueries } from "./eval-retrieval-queries.ts";
import { lexicalOverlap, paraphraseFor } from "./eval-retrieval-paraphrase.ts";

function n(id: string, doc_no: string, title: string, content: string, type = "Core"): AtlasNode {
  return { id, doc_no, title, type, depth: 3, parentId: null, content, order: 0, addressRefs: [] };
}

describe("generateRetrievalQueries", () => {
  it("emits icd-param and control slices from a tiny fixture", () => {
    const docs: AtlasNode[] = [
      n("icd", "A.6.1.1.1.2.1.1", "Spark Foo Instance Configuration Document", "The documents herein define this instance."),
      n("params", "A.6.1.1.1.2.1.1.1", "Parameters", "The documents herein define the parameters."),
      n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet"),
      n("ctrl", "A.1.1.1", "Spirit Of The Atlas Interpretation", "A".repeat(250) + " governance interpretation body text."),
    ];
    const qs = generateRetrievalQueries(docs, 80);
    expect(qs.some((q) => q.slice === "icd-param" && q.relevant.includes("net"))).toBe(true);
    expect(qs.some((q) => q.slice === "control" && q.relevant.includes("ctrl"))).toBe(true);
  });

  it("builds icd-disambiguation queries from a colliding generic param across distinctive ICDs", () => {
    const docs: AtlasNode[] = [];
    for (let i = 1; i <= 4; i++) {
      const icd = `A.6.1.1.${i}`;
      docs.push(n(`icd${i}`, icd, `Spark Pool ${i} Instance Configuration Document`, "The documents herein define this instance."));
      docs.push(n(`p${i}`, `${icd}.1`, "Parameters", "The documents herein define the parameters."));
      docs.push(n(`n${i}`, `${icd}.1.1`, "Network", i === 1 ? "Ethereum Mainnet" : `Chain ${i}`));
    }
    const qs = generateRetrievalQueries(docs, 80);
    const dis = qs.filter((q) => q.slice === "icd-disambiguation");
    expect(dis.length).toBeGreaterThanOrEqual(4);
    // PARAPHRASED: the query must name the instance but must NOT contain the field
    // label ("Network") or the value — that leakage made the old set a lexical test.
    expect(dis.every((q) => /Spark Pool \d/.test(q.query))).toBe(true);
    expect(dis.every((q) => /which chain does .* run on/.test(q.query))).toBe(true);
    expect(dis.some((q) => /network/i.test(q.query))).toBe(false);
    expect(dis.some((q) => /Ethereum Mainnet/.test(q.query))).toBe(false);
  });

  it("builds kv-record queries for the same record title under different agents", () => {
    // The failure mode: "Freezer Multisig" exists under several agents, so the
    // record title alone can't identify the instance — the agent must come from
    // ancestry. One query per agent, each expecting that agent's own leaf.
    const docs: AtlasNode[] = [];
    for (const [i, agent] of ["Spark", "Grove", "Keel"].entries()) {
      const base = `A.6.1.1.${i + 1}`;
      docs.push(n(`ag${i}`, base, agent, "Agent artifact root."));
      docs.push(n(`ms${i}`, `${base}.1`, "Freezer Multisig", "The documents herein define the multisig."));
      docs.push(n(`a${i}`, `${base}.1.1`, "Address", `The address is 0xabc${i}.`));
      docs.push(n(`s${i}`, `${base}.1.2`, "Required Number Of Signers", `It has a ${i + 2}/5 signing requirement.`));
    }
    const qs = generateRetrievalQueries(docs, 80);
    const kv = qs.filter((q) => q.slice === "kv-record");
    expect(kv.length).toBe(3);
    // "Address" paraphrases to "where is … deployed" — the label never appears.
    expect(kv.map((q) => q.query).sort()).toEqual([
      "where is Grove Freezer Multisig deployed",
      "where is Keel Freezer Multisig deployed",
      "where is Spark Freezer Multisig deployed",
    ]);
    // Each query points at ITS OWN agent's leaf — that's what makes it a
    // disambiguation rather than a title lookup.
    expect(kv.find((q) => q.query.includes("Spark"))!.relevant).toEqual(["a0"]);
    expect(kv.find((q) => q.query.includes("Keel"))!.relevant).toEqual(["a2"]);
    // No duplicate query strings: identical query + different answer is unanswerable.
    expect(new Set(kv.map((q) => q.query)).size).toBe(kv.length);
    // These targets ARE folded by the generic pass, so they're the arm-differential
    // ones — the only queries that can move between policies. A slice of all-controls
    // measures nothing about the policy, which is what happened on 2026-08-17.
    expect(kv.every((q) => q.differential === true)).toBe(true);
  });

  it("marks a target the generic pass does not fold as a non-differential control", () => {
    // Scaffolding leaves ("…are stored here.") are rejected by the kv gates, so these
    // queries are identical in both arms — kept as within-slice controls, flagged so a
    // run can report differential coverage instead of hiding it.
    const docs: AtlasNode[] = [];
    for (const [i, agent] of ["Spark", "Grove"].entries()) {
      const base = `A.6.1.1.${i + 1}`;
      docs.push(n(`ag${i}`, base, agent, "Agent artifact root."));
      docs.push(n(`ar${i}`, `${base}.1`, "Archived Invocations/Instances", "The documents herein organize them."));
      docs.push(n(`s${i}`, `${base}.1.1`, "Suspended Instances", "The subtrees for Suspended Instances are stored here."));
      docs.push(n(`f${i}`, `${base}.1.2`, "Failed Invocations", "The subtrees for failed Invocations are stored here."));
    }
    const kv = generateRetrievalQueries(docs, 80).filter((q) => q.slice === "kv-record");
    expect(kv.length).toBe(2);
    expect(kv.every((q) => q.differential === false)).toBe(true);
  });

  it("skips a record title that only occurs under one agent", () => {
    // Without a collision there is nothing to disambiguate, so it isn't a kv-record
    // query — this keeps the slice measuring the hard case only.
    const docs: AtlasNode[] = [
      n("ag", "A.6.1.1.1", "Spark", "Agent artifact root."),
      n("ms", "A.6.1.1.1.1", "Freezer Multisig", "The documents herein define the multisig."),
      n("a", "A.6.1.1.1.1.1", "Address", "The address is 0xabc."),
      n("s", "A.6.1.1.1.1.2", "Required Number Of Signers", "It has a 2/5 signing requirement."),
    ];
    expect(generateRetrievalQueries(docs, 80).some((q) => q.slice === "kv-record")).toBe(false);
  });

  it("keeps paraphrased queries from restating their own target", () => {
    // The regression this locks out: queries built as `${instance} ${field} ${value}`
    // scored ~1.00 overlap, so the eval measured string matching, not retrieval.
    // Only the deliberate lexical control may sit high.
    const docs: AtlasNode[] = [
      n("icd", "A.6.1.1.1.2.1.1", "Spark Foo Instance Configuration Document", "The documents herein define this instance."),
      n("params", "A.6.1.1.1.2.1.1.1", "Parameters", "The documents herein define the parameters."),
      n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet"),
    ];
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const q of generateRetrievalQueries(docs, 80)) {
      if (q.lexicalControl) continue;
      const t = byId.get(q.relevant[0]!);
      if (!t) continue;
      expect(lexicalOverlap(q.query, `${t.title} ${t.content ?? ""}`)).toBeLessThan(0.6);
    }
  });

  it("never emits a paraphrase that echoes the field name it replaces", () => {
    // A template that reused its own field label would defeat the whole point.
    const fields = ["Network", "Token Address", "Required Number Of Signers", "Signers", "Address"];
    for (const f of fields) {
      const phrase = paraphraseFor(f);
      expect(phrase).not.toBeNull();
      const q = phrase!("SUBJECT").toLowerCase();
      for (const w of f.toLowerCase().split(/\s+/)) {
        if (w.length < 4) continue; // "of", "the" are unavoidable connectives
        expect(q).not.toContain(w);
      }
    }
  });
});
