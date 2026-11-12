// Agent name → doc_no scopes for build-history's bullet matcher. The loader
// reads the built relations.json + docs.json; these fixtures stand in for them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentNamePrefixes } from "../scripts/lib/history-agent-scopes.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function checkout(files: { relations?: unknown; docs?: unknown }): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-scopes-"));
  roots.push(root);
  const pub = path.join(root, "public");
  mkdirSync(pub);
  if ("relations" in files) writeFileSync(path.join(pub, "relations.json"), JSON.stringify(files.relations));
  if ("docs" in files) writeFileSync(path.join(pub, "docs.json"), JSON.stringify(files.docs));
  return root;
}

const docs = { nodes: { spark: { doc_no: "A.6.1.1.1" }, keel: { doc_no: "A.6.1.1.3" }, bare: {} } };

describe("loadAgentNamePrefixes", () => {
  it("returns nothing when either built artifact is missing", () => {
    expect(loadAgentNamePrefixes(checkout({}))).toEqual([]);
    expect(loadAgentNamePrefixes(checkout({ relations: { entities: [] } }))).toEqual([]);
    expect(loadAgentNamePrefixes(checkout({ docs }))).toEqual([]);
  });

  it("keeps named agents that have a doc number, longest name first", () => {
    const root = checkout({
      relations: {
        entities: [
          { et: "agent", did: "keel", name: "Keel" },
          { et: "instance", did: "spark", name: "Not an agent" },
          { et: "agent", did: "missing-doc", name: "Ghost" },
          { et: "agent", name: "No document id" },
          { et: "agent", did: "spark", name: "" },
          { et: "agent", did: "bare", name: "No number" },
          { et: "agent", did: "spark", name: "Launch Agent 7" },
        ],
      },
      docs,
    });
    expect(loadAgentNamePrefixes(root)).toEqual([
      ["Launch Agent 7", "A.6.1.1.1"],
      ["Keel", "A.6.1.1.3"],
    ]);
  });

  it("returns nothing when relations.json lists no entities", () => {
    expect(loadAgentNamePrefixes(checkout({ relations: {}, docs }))).toEqual([]);
  });
});
