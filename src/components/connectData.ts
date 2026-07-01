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
  { ask: "List every Action Tenet under the Governance scope.", tools: ["atlas_filter"] },
];

// The atlas tool set, mirrored from src/server/tool-registry.ts (ATLAS_TOOLS).
export const TOOLS: { name: string; desc: string }[] = [
  { name: "atlas_search", desc: "Lexical / semantic / hybrid search over the whole atlas." },
  { name: "atlas_get", desc: "Fetch nodes by UUID or doc_no, each with its full ancestor chain." },
  { name: "atlas_describe", desc: "Live schema: doc-type and edge-type vocabularies, entity types, atlas commit pin." },
  { name: "atlas_get_address", desc: "Look up an on-chain address — merged atlas + chain metadata, linked entity, referencing docs." },
  { name: "atlas_neighbors", desc: "Hierarchical context around a node: parent, siblings, children." },
  { name: "atlas_traverse", desc: "Follow typed edges up to N hops from a node." },
  { name: "atlas_entity", desc: "Everything tied to a named entity (agent, role, actor)." },
  { name: "atlas_filter", desc: "Filter docs by type, entity subtree, ancestor, doc_no pattern, or depth." },
  { name: "atlas_entity_params", desc: "Read an instance's Core children as a parameter map." },
  { name: "atlas_history", desc: "Change log for one doc, newest first, with PR metadata and optional diffs." },
  { name: "atlas_recent_changes", desc: "Recent changes across the atlas, filterable by type / entity." },
  { name: "atlas_pr", desc: "Every doc touched by a single next-gen-atlas PR." },
  { name: "atlas_changed_between", desc: "Docs added/modified/moved/removed between two atlas commits." },
  { name: "atlas_query", desc: "One-call multi-dimensional query — search × graph × type × history × scope, intersected." },
];
