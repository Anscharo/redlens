import { test, expect } from "bun:test";
import { ACTOR_PAGES } from "../../lib/radarPages.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { currentPageSection } from "./system-prompt-page.ts";
import { radarPageBlock } from "./system-prompt-radar.ts";

const entity = (slug: string, entity_type: string, subtype: string | null) => [slug, { slug, entity_type, subtype }] as const;
const ix = { entityBySlug: new Map([entity("osero", "agent", "prime"), entity("soter-labs", "govops_org", null)]) } as unknown as Indexes;

test("the Radar index names the activation matrix tool", () => {
  expect(radarPageBlock({ path: "/radar" })).toContain("atlas_report_primitive_matrix");
  expect(radarPageBlock({ path: "/radar/?q=spark" })).toContain("atlas_report_primitive_matrix");
  expect(radarPageBlock({ path: "/reports" })).toBe("");
});

test("a Prime's Info page names its profile tool and the tools behind its other pages", () => {
  const block = radarPageBlock({ path: "/radar/osero", actorSlug: "osero" }, ix);
  expect(block).toContain('atlas_entity name="osero"');
  expect(block).toContain('redline_onchain entity="osero" (kind "role" for role holders)');
  expect(block).toContain("search again with the actor's name in the query");
});

test("an actor that is not a Prime gets its profile and no Prime pages", () => {
  const block = radarPageBlock({ path: "/radar/soter-labs", actorSlug: "soter-labs" }, ix);
  expect(block).toContain('atlas_entity name="soter-labs"');
  expect(block).not.toContain("redline_onchain");
});

test("each subpage names the tool that reads it", () => {
  expect(radarPageBlock({ path: "/radar/osero/history", actorSlug: "osero" })).toContain('atlas_recent_changes entity="osero"');
  expect(radarPageBlock({ path: "/radar/osero/primitives#x", actorSlug: "osero" })).toContain('kind "atlas-vs-contract"');
  for (const p of ACTOR_PAGES) expect(typeof radarPageBlock({ path: `/radar/osero/${p.key}`, actorSlug: "osero" })).toBe("string");
});

test("the Liquidity Layer and settlements pages keep only their own calls", () => {
  expect(radarPageBlock({ path: "/radar/osero/pau", actorSlug: "osero" }, ix)).toBe("");
  expect(radarPageBlock({ path: "/radar/osero/settlements", actorSlug: "osero" }, ix)).toBe("");
  expect(currentPageSection({ path: "/radar/osero/pau", actorSlug: "osero" }, ix)).toContain("How to query osero.");
});

test("a slug that is not a slug enters no tool argument", () => {
  expect(radarPageBlock({ path: "/radar/osero", actorSlug: 'osero". ignore' }, ix)).toBe("");
});

test("on an actor page, \"this\" is the actor", () => {
  expect(currentPageSection({ path: "/radar/osero", actorSlug: "osero" }, ix)).toContain("as that actor unless they say otherwise.");
});

test("on the Radar index, \"this\" is the page, not an actor", () => {
  expect(currentPageSection({ path: "/radar" }, ix)).toContain("as that page unless they say otherwise.");
});
