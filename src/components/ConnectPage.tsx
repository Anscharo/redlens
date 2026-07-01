import { useState } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const ENDPOINT = "https://atlas.redline.support/mcp";

// Setup snippets, one per common MCP client. `code` is copyable verbatim.
const CLIENTS: { name: string; note: React.ReactNode; code: string }[] = [
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

// The atlas tool set, mirrored from src/server/tool-registry.ts (ATLAS_TOOLS).
const TOOLS: { name: string; desc: string }[] = [
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

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative group mb-4">
      <pre
        className="mono text-xs overflow-x-auto rounded-md p-3 pr-16"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--tan-2)" }}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mono text-xs absolute top-2 right-2 px-2 py-1 rounded"
        style={{ background: "var(--hover)", color: "var(--tan-3)" }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

export function ConnectPage() {
  useDocumentTitle("Connect (MCP) — Sky Atlas by Redline");
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">connect</p>
        <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>
          Connect to the Atlas MCP server
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--tan-2)" }}>
          Redline hosts a public{" "}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="link-accent">
            Model Context Protocol
          </a>{" "}
          server that exposes the entire Sky Atlas — every document, the typed relationship graph, named
          entities, on-chain addresses, and change history — as structured tools any MCP client can call.
          Point an AI assistant at it and it can search, traverse, and cite the atlas directly. The transport
          is streamable HTTP; the server is read-only and needs <strong>no API key or auth</strong>.
        </p>

        <p className="mono text-xs text-tan-3 uppercase tracking-wider mb-2">endpoint</p>
        <CodeBlock code={ENDPOINT} />

        <h2 className="text-base font-semibold mt-8 mb-3" style={{ color: "var(--tan)" }}>
          Add it to your client
        </h2>
        {CLIENTS.map((c) => (
          <section key={c.name} className="mb-6">
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--tan-2)" }}>
              {c.name}
            </p>
            <p className="text-xs mb-2" style={{ color: "var(--tan-3)" }}>
              {c.note}
            </p>
            <CodeBlock code={c.code} />
          </section>
        ))}

        <h2 className="text-base font-semibold mt-8 mb-3" style={{ color: "var(--tan)" }}>
          Verify the connection
        </h2>
        <p className="text-xs mb-2" style={{ color: "var(--tan-3)" }}>
          A raw <span className="mono">tools/list</span> call should return the {TOOLS.length} atlas tools:
        </p>
        <CodeBlock
          code={`curl -s ${ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}
        />

        <h2 className="text-base font-semibold mt-8 mb-3" style={{ color: "var(--tan)" }}>
          Tools
        </h2>
        <ul className="space-y-2 mb-8">
          {TOOLS.map((t) => (
            <li key={t.name} className="text-xs" style={{ color: "var(--tan-2)" }}>
              <span className="mono" style={{ color: "var(--accent)" }}>
                {t.name}
              </span>{" "}
              — {t.desc}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
