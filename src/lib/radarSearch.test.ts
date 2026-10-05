import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "@/lib/graphData";
import { RADAR_GROUP_CAP, getRadarSearchIndex, matchByName, searchRadar } from "./radarSearch";
import { instanceAnchor } from "./radarAnchors";

const EVM = "0xabcdef0123456789abcdef0123456789abcdef01";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const ent = (id: string, et: string, extra: Partial<GraphEntity> = {}): GraphEntity => ({
  id,
  et,
  name: id,
  slug: id,
  st: null,
  did: null,
  ...extra,
});
const instMeta = (params: Record<string, [string, string]>, agent = "doc-spark") =>
  JSON.stringify({ agent_doc_id: agent, status: "Active", params });

function fixture(extraInstances: GraphEntity[] = []): GraphData {
  return {
    participants: [
      ent("spark", "agent", { name: "Spark", did: "doc-spark" }),
      ent("soter", "facilitator_org", { name: "Soter Labs" }),
      ent("safe", "multisig", { name: "Spark Safe", m: JSON.stringify({ address: EVM }) }),
    ],
    primitives: [ent("prim", "primitive", { st: "distribution-reward", m: instMeta({}) })],
    instances: [
      ent("i1", "instance", {
        name: "Spark Distribution Reward",
        st: "distribution-reward",
        m: instMeta({
          "Token Address": [SOL, ""],
          "Wallet Address": [EVM, ""],
          Rate: ["pays [rewards](x) every month to holders of the token", ""],
          "Tracking Methodology": ["secret-forward-ref", ""],
        }),
      }),
      ent("i-orphan", "instance", {
        name: "Orphan Reward",
        st: "light-agent",
        m: instMeta({ Rate: ["orphan rate", ""] }),
      }),
      ...extraInstances,
    ],
    invocations: [],
    edges: [
      { e: "facilitates", f: "soter", t: "spark", ft: "entity", tt: "entity" } as RelationEdge,
      { e: "controls", f: "spark", t: "safe", ft: "entity", tt: "entity" } as RelationEdge,
    ],
  };
}

const run = (g: GraphData, q: string) => searchRadar(getRadarSearchIndex(g), q);
const kinds = (g: GraphData, q: string) => run(g, q).map((x) => x.kind);

describe("searchRadar", () => {
  it("returns [] for a blank query", () => {
    expect(run(fixture(), "  ")).toEqual([]);
  });

  it("orders groups actor, instance, param, address, relationship and omits empty ones", () => {
    const groups = run(fixture(), "spark");
    expect(groups.map((g) => g.kind)).toEqual(["actor", "instance", "relationship"]);
    expect(groups[0].hits.map((h) => h.label)).toEqual(["Spark", "Spark Safe"]);
  });

  it("caches the index per graph object", () => {
    const g = fixture();
    expect(getRadarSearchIndex(g)).toBe(getRadarSearchIndex(g));
    expect(getRadarSearchIndex(fixture())).not.toBe(getRadarSearchIndex(g));
  });

  it("links an instance to its owner's card and drops unowned rows", () => {
    const [group] = run(fixture(), "reward").filter((g) => g.kind === "instance");
    expect(group.hits.map((h) => h.label)).toEqual(["Spark Distribution Reward"]);
    expect(group.hits[0].href).toBe(`/radar/spark#${instanceAnchor("i1")}`);
  });

  it("caps each group at 20 and reports the uncapped total", () => {
    const many = Array.from({ length: 25 }, (_, n) =>
      ent(`m${n}`, "instance", {
        name: `Bulk ${n}`,
        st: "distribution-reward",
        m: instMeta({}),
      }),
    );
    const [group] = run(fixture(many), "bulk");
    expect(group.hits).toHaveLength(RADAR_GROUP_CAP);
    expect(group.total).toBe(25);
  });

  it("searches params only from 3 characters, hides blacklisted keys, shows an excerpt", () => {
    const g = fixture();
    expect(kinds(g, "mo")).not.toContain("param");
    const param = run(g, "month").find((x) => x.kind === "param")!;
    expect(param.hits).toHaveLength(1);
    expect(param.hits[0].excerpt).toContain("every month");
    expect(param.hits[0].excerpt).not.toContain("](");
    expect(kinds(g, "secret-forward-ref")).not.toContain("param");
  });

  it("matches an EVM address by prefix and exact, not by inner substring", () => {
    const g = fixture();
    const prefix = run(g, "0xabcdef").find((x) => x.kind === "address")!;
    expect(prefix.hits.map((h) => h.slug).sort()).toEqual(["safe", "spark"]);
    expect(run(g, EVM.toUpperCase().replace("0X", "0x")).find((x) => x.kind === "address")!.hits).toHaveLength(2);
    expect(kinds(g, "0x123456")).not.toContain("address");
    expect(kinds(g, "bcdef0123")).not.toContain("address");
  });

  it("skips the param group for an address-shaped query", () => {
    expect(kinds(fixture(), "0xabcdef")).not.toContain("param");
    expect(kinds(fixture(), "7xKXtg2")).toEqual(["address"]);
  });

  it("links a multisig address to the multisig's own page", () => {
    const addr = run(fixture(), EVM).find((x) => x.kind === "address")!;
    expect(addr.hits.find((h) => h.slug === "safe")!.href).toBe("/radar/safe");
    expect(addr.hits.find((h) => h.slug === "spark")!.href).toBe(`/radar/spark#${instanceAnchor("i1")}`);
  });

  it("lists a relationship on each end's page, labelled by the other end", () => {
    const rel = run(fixture(), "soter").find((x) => x.kind === "relationship")!;
    expect(rel.hits).toHaveLength(1);
    expect(rel.hits[0]).toMatchObject({ label: "Soter Labs", slug: "spark", href: "/radar/spark#relationships" });
    const back = run(fixture(), "spark").find((x) => x.kind === "relationship")!;
    expect(back.hits.map((h) => h.slug).sort()).toEqual(["safe", "soter", "spark"]);
  });

  it("drops participants without a slug and keeps every href under /radar/", () => {
    const g = fixture();
    g.participants.push(ent("noslug", "agent", { name: "Spark Ghost", slug: "" }));
    const groups = run(g, "spark");
    expect(groups[0].hits.map((h) => h.label)).not.toContain("Spark Ghost");
    for (const grp of [...groups, ...run(g, "0xabcdef"), ...run(g, "month")])
      for (const h of grp.hits) expect(h.href.startsWith("/radar/")).toBe(true);
  });
});

describe("matchByName", () => {
  const rows = [{ name: "Skybase" }, { name: "Sky Reserve" }, { name: "Spark" }];

  it("returns [] for a blank query", () => expect(matchByName("   ", rows)).toEqual([]));

  it("scores exact 3, prefix 2, substring 1", () => {
    expect(matchByName("spark", rows)[0]).toMatchObject({ item: { name: "Spark" }, score: 3 });
    const sky = matchByName("sky", rows);
    expect(sky.map((h) => h.item.name)).toEqual(["Skybase", "Sky Reserve"]);
    expect(sky[0].score).toBe(2);
    expect(matchByName("park", rows)).toMatchObject([{ score: 1 }]);
    expect(matchByName("nonexistent", rows)).toEqual([]);
  });

  it("matches a plural token from a singular query and keeps exact above it", () => {
    const named = [{ name: "Stability Subsidies" }, { name: "Subsidy" }];
    expect(matchByName("subsidy", [named[0]])[0].score).toBe(1);
    const hits = matchByName("subsidy", named);
    expect(hits.map((h) => h.item.name)).toEqual(["Subsidy", "Stability Subsidies"]);
  });
});
