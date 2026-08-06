// Unit tests for Pattern 22 prime-agent omni-doc governance metadata
// extraction (scripts/lib/graph-omni.mjs). Content shapes are drawn from
// real atlas docs under A.6.1.1.X.3.1 (verified against public/docs.json).

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractOmni } from "../scripts/lib/graph-omni.mjs";

function entity(slug: string, name: string): any {
  return { id: slug, slug, name, entity_type: "agent", subtype: "prime", defining_doc_id: null, is_active: 1, meta: null };
}

function doc(id: string, doc_no: string, title: string, content: string): any {
  return { id, doc_no, title, type: "Core", content };
}

const sparkAgentDoc = doc("agent-spark", "A.6.1.1.1", "Spark", "");
const sparkEntity = entity("spark", "Spark");

function run(docs: any[], entityByDocId: Map<string, any>) {
  const edges: any[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const docByDocNo = new Map(docs.map((d) => [d.doc_no, d]));
  const result = extractOmni(docs, docById, docByDocNo, entityByDocId, edges);
  return { result, edges };
}

describe("extractOmni — governance channels", () => {
  it("extracts a Sky Forum channel with its posting category", () => {
    // A.6.1.1.1.3.1.1 (real atlas content).
    const d = doc(
      "d1",
      "A.6.1.1.1.3.1.1",
      "Sky Forum",
      'Spark uses the Sky Forum for governance-related discussion. Posts should use the "Spark Prime" category.',
    );
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 1, emergencies: 0, warnings: 0 });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromId: "d1",
      fromType: "doc",
      toId: "spark",
      toType: "entity",
      edgeType: "governance_channel",
      sourceDocNos: ["A.6.1.1.1.3.1.1"],
    });
    expect(JSON.parse(edges[0].meta)).toEqual({ platform: "forum", category: "Spark Prime" });
  });

  it("extracts a Discord channel with its URL", () => {
    // A.6.1.1.1.3.1.2 (real atlas content).
    const d = doc(
      "d2",
      "A.6.1.1.1.3.1.2",
      "Discord",
      "Spark also uses Discord for more immediate communication. The Spark Discord is located at [https://t.co/v6zG0MZtak](https://t.co/v6zG0MZtak).",
    );
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 1, emergencies: 0, warnings: 0 });
    expect(JSON.parse(edges[0].meta)).toEqual({ platform: "discord", url: "https://t.co/v6zG0MZtak" });
  });

  it("warns but still emits the edge when a Sky Forum doc has no category sentence", () => {
    const d = doc("d3", "A.6.1.1.1.3.1.7", "Sky Forum", "Spark uses the Sky Forum for governance discussion.");
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 1, emergencies: 0, warnings: 1 });
    expect(JSON.parse(edges[0].meta)).toEqual({ platform: "forum" });
  });

  it("warns but still emits the edge when a Discord doc has no URL", () => {
    const d = doc("d4", "A.6.1.1.1.3.1.8", "Discord", "Spark also uses Discord for immediate communication.");
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 1, emergencies: 0, warnings: 1 });
    expect(JSON.parse(edges[0].meta)).toEqual({ platform: "discord" });
  });
});

describe("extractOmni — emergency response", () => {
  it("marks an ecosystem-wide response as placeholder when the atlas defers it", () => {
    // A.6.1.1.1.3.1.5 (real atlas content).
    const d = doc(
      "d5",
      "A.6.1.1.1.3.1.5",
      "Sky Ecosystem Emergency Response",
      "The documents herein specify Spark's emergency response protocol in situations that impact the entire Sky Ecosystem. This protocol will be specified in a future iteration of the Spark Artifact.",
    );
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 0, emergencies: 1, warnings: 0 });
    expect(edges[0].edgeType).toBe("emergency_response");
    expect(JSON.parse(edges[0].meta)).toEqual({ scope: "ecosystem", status: "placeholder" });
  });

  it("marks an agent-specific response as specified once the atlas has real content", () => {
    // A.6.1.1.1.3.1.6 title shape, non-placeholder content.
    const d = doc(
      "d6",
      "A.6.1.1.1.3.1.6",
      "Agent-Specific Emergency Response",
      "In an incident solely impacting Spark, the Core Facilitator convenes an emergency call and posts a public incident report within 24 hours.",
    );
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 0, emergencies: 1, warnings: 0 });
    expect(JSON.parse(edges[0].meta)).toEqual({ scope: "agent_specific", status: "specified" });
  });
});

describe("extractOmni — gating and skips", () => {
  it("warns and skips when no Prime Agent entity resolves for the doc_no", () => {
    const d = doc("d7", "A.6.1.1.1.3.1.9", "Discord", "Located at [url](https://discord.gg/example).");
    const { result, edges } = run([d], new Map());
    expect(result).toEqual({ channels: 0, emergencies: 0, warnings: 1 });
    expect(edges).toEqual([]);
  });

  it("ignores a Governance Information child whose title isn't a channel or emergency doc", () => {
    // A.6.1.1.1.3.1.3 "Delegation Framework" — doc_no matches GOV_INFO_RE,
    // but the title gate (Sky Forum / Discord / *Emergency Response) excludes it.
    const d = doc(
      "d8",
      "A.6.1.1.1.3.1.3",
      "Delegation Framework",
      "The documents herein specify Spark's governance delegation system.",
    );
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 0, emergencies: 0, warnings: 0 });
    expect(edges).toEqual([]);
  });

  it("ignores a doc whose doc_no doesn't match the Governance Information child shape", () => {
    const d = doc("d9", "A.6.1.1.1.3.2.1", "Sky Forum", "Not actually under Governance Information.");
    const entityByDocId = new Map([[sparkAgentDoc.id, sparkEntity]]);
    const { result, edges } = run([sparkAgentDoc, d], entityByDocId);
    expect(result).toEqual({ channels: 0, emergencies: 0, warnings: 0 });
    expect(edges).toEqual([]);
  });
});
