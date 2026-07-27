// query-schema.ts is a zod shape object (no default export, no parse fn of its
// own) shared by the MCP tool and the chat agentic loop. Run under `bun test`.
// The meaningful thing to lock down is the parse contract each field promises
// (defaults, bounds, enum membership) since both consumers rely on it exactly.
import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { atlasQueryShape } from "./query-schema.ts";

const schema = z.object(atlasQueryShape);

describe("atlasQueryShape", () => {
  it("parses a minimal object, applying k and enrich defaults", () => {
    const parsed = schema.parse({});
    expect(parsed.k).toBe(10);
    expect(parsed.enrich).toBe(false);
  });

  it("accepts a fully populated set of fields", () => {
    const input = {
      q: "savings rate",
      entity: "spark",
      edge_types: ["mentions"],
      target_type: "Core",
      via_entity_type: "ecosystem_actor",
      recent_commits: 10,
      since: "30d",
      until: "2024-01-01",
      change_type: "content" as const,
      status: "Active",
      ancestor_id: "A.1",
      include_params: true,
      direction: "out" as const,
      k: 25,
      enrich: true,
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it("rejects a change_type outside the enum", () => {
    expect(() => schema.parse({ change_type: "bogus" })).toThrow();
  });

  it("rejects a direction outside the enum", () => {
    expect(() => schema.parse({ direction: "sideways" })).toThrow();
  });

  it("enforces k bounds (1..50, integer)", () => {
    expect(() => schema.parse({ k: 0 })).toThrow();
    expect(() => schema.parse({ k: 51 })).toThrow();
    expect(() => schema.parse({ k: 1.5 })).toThrow();
    expect(schema.parse({ k: 1 }).k).toBe(1);
    expect(schema.parse({ k: 50 }).k).toBe(50);
  });

  it("enforces recent_commits bounds (1..500, integer) when provided", () => {
    expect(() => schema.parse({ recent_commits: 0 })).toThrow();
    expect(() => schema.parse({ recent_commits: 501 })).toThrow();
    expect(schema.parse({ recent_commits: 500 }).recent_commits).toBe(500);
    expect(schema.parse({}).recent_commits).toBeUndefined();
  });
});
