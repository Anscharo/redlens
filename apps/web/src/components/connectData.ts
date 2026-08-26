// Static content for the /connect page (ConnectPage.tsx). Kept out of the
// component so the page stays a thin layout. All strings, no JSX.

export const ENDPOINT = "https://atlas.redline.support/mcp";

// Setup snippets, one per common MCP client. `code` is copyable verbatim.
export const CLIENTS: { name: string; note: string; code: string }[] = [
  {
    name: "Claude Code (CLI)",
    note: "One command adds it as an HTTP server. Check it with `claude mcp list`.",
    code: `claude mcp add --transport http redline-atlas ${ENDPOINT}`,
  },
  {
    name: "Claude Desktop / claude.ai",
    note: "Settings → Connectors → Add custom connector. Paste the endpoint URL; leave auth blank — the server is public and read-only.",
    code: ENDPOINT,
  },
  {
    name: "Project config (.mcp.json, Cursor, Windsurf, …)",
    note: "Drop this into your client's MCP config. Most editors read the same shape.",
    code: `{
  "mcpServers": {
    "redline-atlas": {
      "type": "http",
      "url": "${ENDPOINT}"
    }
  }
}`,
  },
];

// Example prompts for the "Using it" section — natural-language asks paired
// with the tool(s) an assistant typically reaches for. Illustrative, not exact.
export const USAGE_EXAMPLES: { ask: string; tools: string[] }[] = [
  { ask: "What are the Operational Facilitator's responsibilities?", tools: ["atlas_entity", "atlas_search"] },
  { ask: "What did PR #256 change in the atlas?", tools: ["atlas_pr"] },
  { ask: "Who controls address 0x…?", tools: ["atlas_get_address"] },
  { ask: "How does the facilitator → executor → prime chain work?", tools: ["atlas_describe", "atlas_traverse"] },
  { ask: "What Active Data is Spark responsible for, and has any of it changed recently?", tools: ["atlas_query"] },
  { ask: "How much did Spark send to Sky last cycle?", tools: ["external_msc"] },
  { ask: "Rank primes by To Sky in 2026-07", tools: ["external_msc"] },
];
