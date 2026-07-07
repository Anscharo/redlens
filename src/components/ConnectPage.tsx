import { useState } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ENDPOINT, CLIENTS, TOOLS, USAGE_EXAMPLES } from "./connectData";

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
          Using it
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--tan-2)" }}>
          You don't call the tools by hand. Ask your assistant governance questions in plain language and it
          picks the right atlas tools on its own — starting broad (search) and drilling down (get, neighbors,
          traverse). Every result carries UUIDs, doc numbers, and ancestor chains, so you can always ask it to{" "}
          <em>cite the exact sections</em> and get verifiable references instead of a paraphrase.
        </p>
        <ul className="space-y-2 mb-8">
          {USAGE_EXAMPLES.map((e) => (
            <li key={e.ask} className="text-xs" style={{ color: "var(--tan-2)" }}>
              <span style={{ color: "var(--tan)" }}>“{e.ask}”</span>{" "}
              <span className="text-tan-3">
                → {e.tools.map((t) => (
                  <span key={t} className="mono" style={{ color: "var(--accent)" }}>
                    {t}{" "}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>

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
