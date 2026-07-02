import { test, expect } from "@playwright/test";

// First E2E spec — the ci.yml curl smoke, ported to run against the live Railway
// PR environment (real Docker image, real workers, real DB). These two checks
// prove the deploy is actually up and serving before any UI specs run:
//   1. /api/health   — process is up and its Postgres is reachable
//   2. POST /mcp      — the MCP server is wired and exposing the atlas tools
// Both are root-path API routes, so they're independent of the SPA base path.

test.describe("deploy smoke", () => {
  test("GET /api/health reports a reachable DB", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // status is a derived enum (ok/syncing/stale/…) that can be non-"ok" on a
    // healthy box; assert DB reachability rather than the status string.
    expect(body.db_reachable).toBe(true);
  });

  test("POST /mcp tools/list exposes the atlas tools", async ({ request }) => {
    const res = await request.post("/mcp", {
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(res.ok()).toBeTruthy();
    // The streamable-HTTP transport may answer as SSE; assert on the raw text.
    const text = await res.text();
    expect(text).toContain("atlas_query");
    expect(text).toContain("atlas_entities"); // the discovery tool added on this branch
  });
});

// Behavioral smoke over a few tools — these run against the REAL deployed MCP,
// so they catch regressions this session's unit tests can't (index loading,
// pg wiring, the transport). Each asserts a shape invariant, not exact content,
// to stay robust to atlas edits. A tool call comes back as a JSON-RPC envelope
// (JSON or SSE) whose result.content[0].text is the tool payload JSON.
async function callTool(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, any>> {
  const res = await request.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  let env: any;
  try {
    env = JSON.parse(text);
  } catch {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    env = JSON.parse(data.find((d) => d.includes('"result"')) ?? data[data.length - 1]);
  }
  expect(env.result).toBeTruthy();
  return JSON.parse(env.result.content[0].text);
}

test.describe("mcp tool behavior", () => {
  test("atlas_describe: provenance stamped + heavy sections opt-in", async ({ request }) => {
    const d = await callTool(request, "atlas_describe", {});
    expect(d._meta.appCommit).toBeTruthy(); // was hardcoded null before this branch
    expect(d._meta.generatedAt).toBeTruthy();
    expect(Array.isArray(d.doc_types)).toBe(true);
    expect(d.entity_type_graph).toBeUndefined(); // opt-in via `sections`
  });

  test("atlas_entity resolves a natural-language name", async ({ request }) => {
    const e = await callTool(request, "atlas_entity", { name: "Spark Protocol", limit: 1 });
    expect(e.resolved.slug).toBe("spark");
    expect(e.node_types).toBeDefined();
    expect(Array.isArray(e.alternatives)).toBe(true);
  });

  test("atlas_traverse tags results with hops/edge_type/direction (not depth)", async ({ request }) => {
    // Start from a live search hit so we don't hardcode a (renumberable) doc_no.
    const s = await callTool(request, "atlas_search", { query: "agent rate", mode: "lexical", k: 1 });
    const id = s.results[0].id;
    const t = await callTool(request, "atlas_traverse", { id, hops: 1, direction: "both" });
    expect(t.results.length).toBeGreaterThan(0);
    for (const r of t.results) {
      expect(r.hops).toBe(1);
      expect(typeof r.edge_type).toBe("string");
      expect(["out", "in"]).toContain(r.direction);
    }
  });

  test("atlas_search lexical type filter returns only that type", async ({ request }) => {
    const s = await callTool(request, "atlas_search", { query: "agent rate", mode: "lexical", type: "Core", k: 5 });
    expect(s.results.length).toBeGreaterThan(0); // empty here would mean the filter is broken again
    expect(s.results.every((r: any) => r.type === "Core")).toBe(true);
  });

  test("atlas_query is lean by default (retrieve-then-read)", async ({ request }) => {
    const q = await callTool(request, "atlas_query", { q: "agent rate", k: 3, enrich: false });
    expect(q.results.length).toBeGreaterThan(0);
    expect(q.results[0].content).toBeUndefined(); // lean rows
    expect(q.results[0].snippet).toBeDefined();
  });
});

// DB-backed tools (Postgres: atlas_history / atlas_recent_changes / atlas_pr /
// atlas_changed_between / atlas_get_address). Can't be unit-tested without a DB,
// so they're smoked here against the deployed env's real synced Postgres. Inputs
// are derived from live data (recent changes, address refs) so nothing hardcodes
// a renumberable doc_no or a mutable address.
test.describe("mcp db-backed tools", () => {
  test("recent_changes → history → pr chain off live history", async ({ request }) => {
    const rc = await callTool(request, "atlas_recent_changes", { k: 5 });
    expect(Array.isArray(rc.events)).toBe(true);
    test.skip(rc.events.length === 0, "live preview DB has no synced atlas history yet");
    const ev = rc.events[0];

    const h = await callTool(request, "atlas_history", { id: ev.doc_id });
    expect(h.doc.id).toBe(ev.doc_id);
    expect(Array.isArray(h.events)).toBe(true);
    expect(h.events.length).toBeGreaterThan(0);

    if (ev.pr_number) {
      const pr = await callTool(request, "atlas_pr", { pr_number: ev.pr_number });
      expect(pr.pr.number).toBe(ev.pr_number);
      expect(pr.count).toBeGreaterThan(0);
    }
  });

  test("changed_between spans two real commits", async ({ request }) => {
    const rc = await callTool(request, "atlas_recent_changes", { k: 50 });
    const shas: string[] = [...new Set(rc.events.map((e: any) => e.commit_sha).filter(Boolean))];
    test.skip(shas.length < 2, "need two distinct commits in history");
    const cb = await callTool(request, "atlas_changed_between", { commit_a: shas[1], commit_b: shas[0] });
    expect(typeof cb.doc_count).toBe("number");
    expect(Array.isArray(cb.docs)).toBe(true);
  });

  test("get_address resolves an address referenced by a doc", async ({ request }) => {
    // Derive a real on-chain address from a doc's addressRefs (robust to edits).
    const s = await callTool(request, "atlas_search", { query: "SubProxy Address", mode: "lexical", k: 10 });
    let addr: string | undefined;
    for (const r of s.results) {
      const doc = await callTool(request, "atlas_get", { id: r.id });
      if (Array.isArray(doc.addressRefs) && doc.addressRefs.length) {
        addr = doc.addressRefs[0];
        break;
      }
    }
    test.skip(!addr, "no address ref found to probe");
    const a = await callTool(request, "atlas_get_address", { address: addr! });
    expect(a.records.length).toBeGreaterThan(0);
    expect(a.records[0].address).toBe(addr!.toLowerCase());
    expect(Array.isArray(a.edges)).toBe(true);
  });
});
