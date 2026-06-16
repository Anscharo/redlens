// Semantic invariants for primitive Instance entities + instance_of edges.
// Read built artifacts; run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode, GraphEntity, RelationEdge } from "../src/types";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
type Relations = { meta: unknown; entities: GraphEntity[]; edges: RelationEdge[] };
const relations: Relations = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;

const INSTANCE_SLUGS = new Set([
  "distribution-reward",
  "integration-boost",
  "allocation-system",
  "pioneer-chain",
  "core-governance-reward",
  "agent-creation",
  "prime-transformation",
  "agent-token",
  "executor-accord",
  "root-edit",
  "distribution-requirement",
  "upkeep-rebate",
  "ecosystem-upkeep-fee",
]);

// Primitives whose ICDs carry Active/Completed/Pending status tiers.
// Agent Creation, Prime Transformation, and Ecosystem Upkeep Fee use
// "Primitive Hub Document" instead — no status derived.
const STATUS_PRIMITIVES = new Set([
  "distribution-reward",
  "integration-boost",
  "allocation-system",
  "pioneer-chain",
  "core-governance-reward",
  "agent-token",
  "executor-accord",
  "root-edit",
  "distribution-requirement",
  "upkeep-rebate",
]);

const instances = relations.entities.filter((e) => e.et === "instance");
const instanceOfEdges = relations.edges.filter((e) => e.e === "instance_of");

describe("instance entity emission", () => {
  it("emits ~170 instance entities across the approved primitive scope", () => {
    expect(instances.length).toBeGreaterThan(150);
    expect(instances.length).toBeLessThan(200);
  });

  it("every instance entity has st set to an allowlisted primitive slug", () => {
    for (const e of instances) {
      expect(
        INSTANCE_SLUGS.has(e.st ?? ""),
        `${e.name} (${e.id.slice(0, 8)}): unexpected st=${e.st}`,
      ).toBe(true);
    }
  });

  it("every instance's did points at an ICD in docs.json", () => {
    for (const e of instances) {
      const d = e.did ? docs[e.did] : null;
      expect(d, `${e.name}: did missing from docs`).toBeTruthy();
      expect(/instance configuration document/i.test(d!.title)).toBe(true);
    }
  });

  it("includes Agent Creation, Prime Transformation, and Ecosystem Upkeep Fee", () => {
    for (const slug of ["agent-creation", "prime-transformation", "ecosystem-upkeep-fee"]) {
      expect(instances.some((e) => e.st === slug), `missing instances for ${slug}`).toBe(true);
    }
  });
});

describe("instance_of edges", () => {
  it("every edge lands on a doc whose title ends in 'Primitive'", () => {
    for (const edge of instanceOfEdges) {
      const target = docs[edge.t];
      expect(
        target,
        `edge ${edge.f.slice(0, 8)} → ${edge.t.slice(0, 8)}: target missing`,
      ).toBeTruthy();
      expect(
        /Primitive$/i.test(target!.title),
        `edge target is "${target!.title}" (${target!.doc_no}) — should end in "Primitive"`,
      ).toBe(true);
    }
  });

  it("every instance entity has a matching instance_of edge whose source is that entity", () => {
    const edgeBySource = new Map(instanceOfEdges.map((e) => [e.f, e]));
    for (const ent of instances) {
      const edge = edgeBySource.get(ent.id);
      expect(edge, `no instance_of edge for ${ent.name} (${ent.id.slice(0, 8)})`).toBeTruthy();
    }
  });

  it("status on edge meta is one of {Active, Completed, Pending} when present", () => {
    for (const edge of instanceOfEdges) {
      if (!edge.m) continue;
      const meta = JSON.parse(edge.m) as { status?: string };
      expect(["Active", "Completed", "Pending"]).toContain(meta.status);
    }
  });

  it("every status-carrying instance entity's edge has status in meta", () => {
    const edgeBySource = new Map(instanceOfEdges.map((e) => [e.f, e]));
    for (const ent of instances.filter((e) => STATUS_PRIMITIVES.has(e.st ?? ""))) {
      const edge = edgeBySource.get(ent.id);
      expect(edge?.m, `${ent.name}: missing status meta`).toBeTruthy();
    }
  });
});

describe("instance params (extracted from ICD Parameters subtree)", () => {
  type Tuple = [string, string, string];
  function meta(ent: GraphEntity): { status?: string; params?: Record<string, Tuple> } {
    try {
      return ent.m ? JSON.parse(ent.m) : {};
    } catch {
      return {};
    }
  }
  function paramsOf(ent: GraphEntity) {
    return meta(ent).params ?? {};
  }

  it("every param is a 3-tuple [value, uuid, docNo]", () => {
    for (const e of instances) {
      for (const [key, tup] of Object.entries(paramsOf(e))) {
        expect(Array.isArray(tup), `${e.name}.${key}: not an array`).toBe(true);
        expect(tup.length, `${e.name}.${key}: expected length 3, got ${tup.length}`).toBe(3);
        expect(typeof tup[0], `${e.name}.${key}: value not string`).toBe("string");
        expect(tup[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(tup[2]).toMatch(/^A\.[\d.]+/);
      }
    }
  });

  it("every Distribution Reward instance has a Reward Code param", () => {
    for (const e of instances.filter((x) => x.st === "distribution-reward")) {
      const p = paramsOf(e);
      expect(p["Reward Code"]?.[0], `${e.name}: missing Reward Code value`).toBeTruthy();
    }
  });

  it("every Integration Boost instance carries Partner Name + Reward Address + Chain", () => {
    for (const e of instances.filter((x) => x.st === "integration-boost")) {
      const p = paramsOf(e);
      expect(p["Integration Partner Name"]?.[0], `${e.name}: partner name`).toBeTruthy();
      expect(
        p["Integration Partner Reward Address"]?.[0],
        `${e.name}: reward address`,
      ).toBeTruthy();
      expect(p["Integration Partner Chain"]?.[0], `${e.name}: chain`).toBeTruthy();
    }
  });

  it("every Agent Token instance has Token Name + Token Symbol + some Token Address* key", () => {
    for (const e of instances.filter((x) => x.st === "agent-token")) {
      const p = paramsOf(e);
      expect(p["Token Name"]?.[0], `${e.name}: token name`).toBeTruthy();
      expect(p["Token Symbol"]?.[0], `${e.name}: token symbol`).toBeTruthy();
      // Compound-prose expansion: agents with deployed tokens get one key per
      // chain ("Token Address (Ethereum Mainnet)", "Token Address (Base)").
      // Agents whose token is unannounced keep a single "Token Address" key
      // carrying the placeholder prose.
      const tokenKey = Object.keys(p).find((k) => /^Token Address(?:$| \()/.test(k));
      expect(
        tokenKey,
        `${e.name}: no Token Address* key; have [${Object.keys(p).join(", ")}]`,
      ).toBeTruthy();
    }
  });

  it("bullet-list rate-limit leaves expand into per-field keys", () => {
    // Allocation System inflow/outflow/deposit/withdrawal/swap rate limits use
    // a backtick-bullet list in prose — the generic expander splits them.
    const sl = instances.find((e) => e.name === "Ethereum Mainnet - SparkLend USDS");
    expect(sl, "SparkLend USDS allocation instance").toBeTruthy();
    const p = paramsOf(sl!);
    expect(p["Inflow Rate Limits / maxAmount"]?.[0]).toBe("200,000,000 USDS");
    expect(p["Inflow Rate Limits / slope"]?.[0]).toBe("400,000,000 USDS per day");
    expect(p["Outflow Rate Limits / maxAmount"]?.[0]).toBe("Unlimited");
    // The outer "Inflow Rate Limits" / "Outflow Rate Limits" keys should NOT
    // be present as single entries — they've been expanded into sub-keys.
    expect(p["Inflow Rate Limits"]).toBeUndefined();
    expect(p["Outflow Rate Limits"]).toBeUndefined();
  });

  it("multi-chain Agent Token produces one key per chain", () => {
    // Spark has SPK on Ethereum Mainnet + Base; the expander must emit both.
    const spark = instances.find((e) => e.st === "agent-token" && e.slug.startsWith("spark-"));
    expect(spark, "Spark agent-token instance").toBeTruthy();
    const p = paramsOf(spark!);
    expect(p["Token Address (Ethereum Mainnet)"]?.[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(p["Token Address (Base)"]?.[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(p["Token Address"]).toBeUndefined();
  });

  it("every Allocation System instance has Network + at least one *Address key", () => {
    for (const e of instances.filter((x) => x.st === "allocation-system")) {
      const p = paramsOf(e);
      expect(p["Network"]?.[0], `${e.name}: network`).toBeTruthy();
      const addrKey = Object.keys(p).find((k) => /Address$|Address\s*\(/.test(k));
      expect(
        addrKey,
        `${e.name}: no *Address key; have [${Object.keys(p).join(", ")}]`,
      ).toBeTruthy();
    }
  });

  it("Inflow/Outflow/Swap RateLimitID values are bare 64-char hex hashes or N/A — not prose sentences", () => {
    const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
    const NA_RE = /^N\/A/i;
    for (const e of instances) {
      const p = paramsOf(e);
      for (const [key, tup] of Object.entries(p)) {
        if (!/^(Inflow|Outflow|Swap) Rate ?Limit ?ID/i.test(key)) continue;
        const value = tup[0];
        expect(
          HASH_RE.test(value) || NA_RE.test(value) || value.startsWith("The "),
          `${e.name}.${key}: unexpected value ${JSON.stringify(value)}`,
        ).toBe(true);
        // Must NOT be the raw prose sentence form "The X RateLimitID is: ..."
        expect(
          value,
          `${e.name}.${key}: value still contains prose — formatter did not strip it`,
        ).not.toMatch(/^The \w+ RateLimitID is:/i);
      }
    }
  });

  it("Allocation System instances with a hash RateLimitID have a valid 64-char hex value", () => {
    const allocations = instances.filter((x) => x.st === "allocation-system");
    const withHash = allocations.filter((e) => {
      const p = paramsOf(e);
      return Object.keys(p).some(
        (k) => /^(Inflow|Outflow|Swap) Rate ?Limit ?ID/i.test(k) && /^0x[0-9a-fA-F]{64}$/.test(p[k][0]),
      );
    });
    expect(withHash.length, "expected some allocation-system instances to have hash RateLimitIDs").toBeGreaterThan(30);
  });

  it("at least 95% of instances carry at least one param", () => {
    const populated = instances.filter((e) => Object.keys(paramsOf(e)).length > 0).length;
    expect(populated / instances.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe("invoked_by edges (instance → prime agent)", () => {
  const invokedBy = relations.edges.filter((e) => e.e === "invoked_by");

  it("every instance entity has exactly one invoked_by edge to an agent/prime", () => {
    const agentPrimes = new Map(
      relations.entities.filter((e) => e.et === "agent" && e.st === "prime").map((e) => [e.id, e]),
    );
    const bySource = new Map<string, number>();
    for (const e of invokedBy) bySource.set(e.f, (bySource.get(e.f) ?? 0) + 1);
    for (const inst of instances) {
      expect(bySource.get(inst.id), `${inst.name}: expected 1 invoked_by edge`).toBe(1);
    }
    for (const e of invokedBy) {
      expect(agentPrimes.has(e.t), `invoked_by target is not a prime agent`).toBe(true);
      expect(e.ft).toBe("entity");
      expect(e.tt).toBe("entity");
    }
  });
});
