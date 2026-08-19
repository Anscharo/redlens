import { test, expect } from "@playwright/test";
import { callTool } from "./mcp";

type QueryPayload = {
  results: Array<{ content?: string; snippet?: string }>;
} & Record<string, unknown>;
type SearchPayload = {
  results: Array<{ id: string }>;
} & Record<string, unknown>;
type DocPayload = {
  addressRefs?: string[];
} & Record<string, unknown>;
type AddressPayload = {
  records: Array<{ address: string }>;
  edges: unknown[];
} & Record<string, unknown>;

// Global setup owns liveness, schema, Atlas convergence, and app provenance.
// Keep only calls that prove a unique deployed boundary: real retrieval through
// streamable HTTP, and agreement between document address refs and Postgres.
test.describe("deployed MCP integration", () => {
  test("atlas_query returns lean rows through the live transport", async ({ request }) => {
    const q = await callTool<QueryPayload>(request, "atlas_query", {
      q: "agent rate",
      k: 3,
      enrich: false,
    });
    expect(q.results.length).toBeGreaterThan(0);
    expect(q.results[0].content).toBeUndefined();
    expect(q.results[0].snippet).toBeDefined();
  });

  test("atlas_get_address resolves an address referenced by a live document", async ({ request }) => {
    let address: string | undefined;
    let sourceId: string | undefined;

    // Broad, stable concepts make this resilient to Atlas regrouping and title
    // edits while still deriving the probe from the currently served dataset.
    for (const query of ["address", "proxy", "ethereum"]) {
      const search = await callTool<SearchPayload>(request, "atlas_search", {
        query,
        mode: "lexical",
        k: 20,
      });
      for (const result of search.results) {
        const doc = await callTool<DocPayload>(request, "atlas_get", { id: result.id });
        if (doc.addressRefs?.length) {
          address = doc.addressRefs[0];
          sourceId = result.id;
          break;
        }
      }
      if (address) break;
    }

    expect(address, "live Atlas search returned no document with an address reference").toBeTruthy();
    // Match atlas_get_address / ingest: EVM keys are lowercased, Solana base58 is not.
    const canonical = address!.startsWith("0x") ? address!.toLowerCase() : address!;
    const payload = await callTool<AddressPayload>(request, "atlas_get_address", { address });
    expect(payload.records, `address ${address} from document ${sourceId} had no database records`).not.toHaveLength(0);
    expect(payload.records.some((record) => record.address === canonical)).toBe(true);
    expect(Array.isArray(payload.edges)).toBe(true);
  });
});
