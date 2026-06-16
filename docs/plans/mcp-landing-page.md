# MCP Landing Page

Saved from `redlens-mcp/src/index.ts` before decommission. This was the public
landing page served at the Cloudflare Workers MCP endpoint root (`GET /`).

The Railway web service (`src/server/index.ts`) currently returns a plain 404
for `GET /`. If a public MCP landing page is desired in the future, this HTML
can be adapted and served there.

The old Cloudflare endpoint was `https://redlens-mcp.anscharo.workers.dev/mcp`.
Any future landing page should update the install URLs and the local dev
instructions to reflect the Railway deployment.

---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RedLens Atlas MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #555; margin-bottom: 32px; }
    .subtitle a { color: #a63228; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 28px 0 8px; }
    pre { background: #f4f1ec; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 0.85rem; }
    code { font-family: "Source Code Pro", monospace; }
    .endpoint { font-size: 0.9rem; color: #444; }
    .endpoint code { background: #f4f1ec; padding: 2px 6px; border-radius: 3px; }
    footer { margin-top: 48px; font-size: 0.8rem; color: #aaa; }
    footer a { color: #aaa; }
  </style>
</head>
<body>
  <h1>RedLens Atlas MCP Server</h1>
  <p class="subtitle">
    Query the <a href="https://github.com/sky-ecosystem/next-gen-atlas" target="_blank">Sky Atlas</a> —
    the governance &amp; operational constitution of the
    <a href="https://sky.money" target="_blank">Sky protocol</a> —
    using natural-language and structured search directly from your AI assistant.
  </p>

  <h2>What is this?</h2>
  <p>
    An <a href="https://modelcontextprotocol.io" target="_blank">MCP (Model Context Protocol)</a> server
    that gives AI tools (Claude, Cursor, etc.) full-text and graph search over the
    Sky Atlas document. Ask your assistant things like
    <em>"What does the Sky Atlas say about USDS stability fees?"</em> or
    <em>"Show me the Active Data sections controlled by Spark."</em>
  </p>

  <h2>Ask the Atlas (Claude Code agent)</h2>
  <p>
    Install the <code>ask-atlas</code> subagent into your project — a Sky Atlas governance specialist
    that retrieves and cites atlas documents to answer questions about rules, roles, primitives, and entities.
  </p>
  <pre><code>mkdir -p .claude/agents && curl -fsSL https://RAILWAY_URL/install/ask-atlas -o .claude/agents/ask-atlas.md</code></pre>
  <p>Then connect the MCP server (see below), reload Claude Code, and invoke with <code>@ask-atlas</code>:</p>
  <pre><code>@ask-atlas What does the Atlas say about USDS stability fees?
@ask-atlas Show me the Active Data sections controlled by Spark
@ask-atlas learn: [paste content] (source: forum post by X)</code></pre>

  <h2>Add to Claude Code</h2>
  <p>Add the following to your project's <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "type": "http",
      "url": "https://RAILWAY_URL/mcp"
    }
  }
}</code></pre>

  <h2>Add to Claude Desktop</h2>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://RAILWAY_URL/mcp"]
    }
  }
}</code></pre>

  <h2>Add to Cursor / other MCP clients</h2>
  <p>Point your client at the streamable HTTP endpoint:</p>
  <pre><code>https://RAILWAY_URL/mcp</code></pre>

  <h2>REST API (no client needed)</h2>
  <p class="endpoint">
    <code>GET /api/search?q=…&amp;k=10</code> — full-text search<br/>
    <code>GET /api/node/:id</code> — fetch node by UUID or doc number<br/>
    <code>GET /api/entity/:name</code> — all sections for a named entity<br/>
    <code>GET /api/address/:addr</code> — address lookup with linked entity + edges<br/>
    <code>GET /api/traverse/:id?hops=2</code> — graph traversal from a node<br/>
    <code>GET /api/meta</code> — current atlas commit + generation timestamp
  </p>

  <h2>Available MCP tools</h2>
  <p class="endpoint">
    <code>atlas_describe</code> — live schema: doc types, edge types, entity slugs, type specs, atlas commit pin<br/>
    <code>atlas_search</code> — lexical/semantic/hybrid search; quoted phrases exact-match<br/>
    <code>atlas_get</code> — single or bulk fetch (array of ids); each result includes ancestor chain<br/>
    <code>atlas_neighbors</code> — parent / siblings / children of a node<br/>
    <code>atlas_traverse</code> — multi-hop typed-edge traversal<br/>
    <code>atlas_entity</code> — aggregate view of a named entity (agent, role, actor)<br/>
    <code>atlas_filter</code> — structural filter: type / entity / ancestor / doc_no_pattern / depth<br/>
    <code>atlas_get_address</code> — on-chain address lookup with merged atlas + chain metadata<br/>
    <code>atlas_entity_params</code> — child-Core "params" of an instance doc (Reward, Primitive Instance, …)<br/>
    <code>atlas_history</code> — change log for one doc, with PR rationale; filter by date range, PR, or change type<br/>
    <code>atlas_recent_changes</code> — global feed of recent changes across the atlas, type-filterable<br/>
    <code>atlas_pr</code> — every doc touched by a single GitHub PR<br/>
    <code>atlas_changed_between</code> — all docs changed between two atlas commits (exact topological order via commit_seq)<br/>
    <code>atlas_query</code> — one-call multi-dimensional query combining search, entity graph, history, and constraints
  </p>

  <footer>
    <a href="https://github.com/anscharo/redlens" target="_blank">github.com/anscharo/redlens</a>
  </footer>
</body>
</html>
```
