import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETTLEMENT_CITATIONS, citationFor } from "./settlementCitations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOCS = path.resolve(__dirname, "../../public/docs.json");

describe("settlement citations", () => {
  it("keys every figure by a distinct UUID", () => {
    const ids = Object.values(SETTLEMENT_CITATIONS).map((c) => c.uuid);
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the figures the Atlas does not define uncited", () => {
    expect(citationFor("gar")).toBeUndefined();
    expect(citationFor("kept")).toBeUndefined();
    expect(citationFor("cof")?.term).toBe("Agent Credit Line Borrow Rate");
  });

  it.skipIf(!fs.existsSync(DOCS))("resolves every UUID in the built docs.json", () => {
    const docs = JSON.parse(fs.readFileSync(DOCS, "utf8")) as { nodes: Record<string, unknown> };
    for (const c of Object.values(SETTLEMENT_CITATIONS)) expect(docs.nodes[c.uuid], c.term).toBeDefined();
  });
});
