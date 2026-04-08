import { useState, useEffect, useRef } from "react";
import { useSearch } from "./hooks/useSearch";
import { useScopes } from "./hooks/useScopes";
import { SearchResult } from "./components/SearchResult";
import { NodeContent } from "./components/NodeContent";
import type { AtlasNode } from "./types";

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-medium",
};

const DEPTH_INDENT: Record<number, string> = {
  1: "pl-0",
  2: "pl-0",
  3: "pl-4",
  4: "pl-8",
  5: "pl-12",
  6: "pl-16",
};

// Extract UUIDs from markdown links in content: [text](uuid)
const UUID_LINK_RE = /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

function extractLinkedIds(nodes: AtlasNode[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of nodes) {
    for (const m of node.content.matchAll(UUID_LINK_RE)) {
      if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    }
  }
  return ids;
}

// ── ScopeNode ──────────────────────────────────────────────────────────────

function ScopeNode({ node, isTarget, onNavigate }: { node: AtlasNode; isTarget: boolean; onNavigate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTarget) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [isTarget]);

  return (
    <div
      ref={ref}
      id={node.id}
      className={["scope-node py-4 border-b cursor-pointer", DEPTH_INDENT[node.depth] ?? "pl-16", isTarget ? "is-target" : "is-muted"].join(" ")}
      onClick={() => onNavigate(node.id)}
      style={{
        borderColor: "var(--border)",
        marginLeft: "-1rem",
        paddingLeft: `calc(${["0","0","1rem","2rem","3rem","4rem"][node.depth - 1] ?? "4rem"} + 1rem)`,
        boxShadow: isTarget ? "inset 3px 0 0 var(--red)" : undefined,
        scrollMarginTop: "64px",
      }}
    >
      <p
        className={`mb-1 ${DEPTH_HEADING[node.depth] ?? "text-sm font-medium"}`}
        style={{ color: "var(--tan)" }}
      >
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{
            background: "var(--surface)",
            color: isTarget ? "var(--red)" : "var(--tan-2)",
            border: "1px solid var(--border)",
          }}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{node.doc_no}</span>
        <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{node.id}</span>
      </div>
      {node.content && (
        <div>
          <NodeContent content={node.content} addresses={node.addresses} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

// ── RelatedNode card ───────────────────────────────────────────────────────

function RelatedNode({ node, onNavigate }: { node: AtlasNode; onNavigate: (id: string) => void }) {
  return (
    <div
      className="py-4 border-b cursor-pointer"
      style={{ borderColor: "var(--border)" }}
      onClick={() => onNavigate(node.id)}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--hover)")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      <p className="text-sm font-semibold mb-1" style={{ color: "var(--tan)" }}>
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-2">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{ background: "var(--surface)", color: "var(--red)", border: "1px solid var(--border)" }}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{node.doc_no}</span>
        <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{node.id}</span>
      </div>
      {node.content && (
        <div className="line-clamp-4 text-sm" style={{ color: "var(--tan-2)" }}>
          <NodeContent content={node.content} addresses={node.addresses} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

// ── NodeDetail ─────────────────────────────────────────────────────────────

function NodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [scopeNodes, setScopeNodes] = useState<AtlasNode[]>([]);
  const [linkedNodes, setLinkedNodes] = useState<AtlasNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/docs.json")
      .then((r) => r.json())
      .then((docs: Record<string, AtlasNode>) => {
        const target = docs[id];
        if (!target) { setLoaded(true); return; }

        const parent = target.parentId ? (docs[target.parentId] ?? target) : target;
        const prefix = parent.doc_no + ".";
        const nodes = Object.values(docs)
          .filter((n) => n.id === parent.id || n.doc_no.startsWith(prefix))
          .sort((a, b) => a.order - b.order);

        const linkedIds = extractLinkedIds([target]);
        const linked = linkedIds.map((lid) => docs[lid]).filter((n): n is AtlasNode => !!n);

        setScopeNodes(nodes);
        setLinkedNodes(linked);
        setLoaded(true);
      });
  }, [id]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--gray)" }}>
        Loading…
      </div>
    );
  }

  if (scopeNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--red)" }}>
        Node not found: {id}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:grid lg:grid-cols-[3fr_2fr]" style={{ minHeight: 0 }}>
      {/* Left — context */}
      <div className="overflow-y-auto" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="max-w-2xl mx-auto px-4 py-6">
          {scopeNodes.map((node) => (
            <ScopeNode key={node.id} node={node} isTarget={node.id === id} onNavigate={onNavigate} />
          ))}
        </div>
      </div>

      {/* Right — linked nodes */}
      <div className="overflow-y-auto hidden lg:block">
        <div className="px-4 py-6">
          {linkedNodes.length > 0 ? (
            <>
              <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                annotations · {linkedNodes.length} linked node{linkedNodes.length !== 1 ? "s" : ""}
              </p>
              {linkedNodes.map((node) => (
                <RelatedNode key={node.id} node={node} onNavigate={onNavigate} />
              ))}
            </>
          ) : (
            <p className="text-xs mono" style={{ color: "var(--tan-3)" }}>annotations · no linked nodes</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SearchHints ────────────────────────────────────────────────────────────


const HINTS: { label: string; query: string; description: string }[] = [
  { label: "exact phrase",       query: '"alignment engineering"',     description: "Wrap in quotes for exact phrases" },
  { label: "wildcard",           query: "govern*",                     description: "Trailing * matches any suffix" },
  { label: "0x address",         query: "0x*",                        description: "All nodes containing an Ethereum address" },
  { label: "doc number",         query: "A.1.2",                      description: "Jump directly to a section by number" },
  { label: "field: title",       query: "title:facilitator",          description: "Search only in the title field" },
  { label: "field: type",        query: "type:Annotation",            description: "Filter by node type" },
  { label: "fuzzy match",        query: "misaligment~1",              description: "~N allows N character edits" },
  { label: "boost term",         query: "delegate^5 voting",          description: "^N boosts a term's relevance weight" },
  { label: "exclude term",       query: "alignment -slippery",        description: "Prefix with - to exclude a term" },
  { label: "combine fields",     query: "type:Core title:quorum",     description: "Mix field filters and free text" },
];

function SearchHints({ onSearch }: { onSearch: (q: string) => void }) {
  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <p className="text-xs mono mb-6" style={{ color: "var(--tan-3)" }}>search patterns</p>
      <div className="space-y-1">
        {HINTS.map((h) => (
          <button
            key={h.query}
            onClick={() => onSearch(h.query)}
            className="w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
            style={{ background: "transparent" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <span className="mono text-xs shrink-0 w-32" style={{ color: "var(--tan-3)" }}>
              {h.label}
            </span>
            <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>
              {h.query}
            </span>
            <span className="text-xs hidden sm:block" style={{ color: "var(--tan-3)" }}>
              {h.description}
            </span>
          </button>
        ))}
      </div>

    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { state, search, ready } = useSearch();
  const scopes = useScopes();
  const [query, setQuery] = useState("");
  const [activeScope, setActiveScope] = useState<AtlasNode | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("id")
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onPopState() {
      setNodeId(new URLSearchParams(window.location.search).get("id"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!nodeId) inputRef.current?.focus();
  }, [nodeId]);

  function navigate(id: string) {
    history.pushState(null, "", `/?id=${id}`);
    setNodeId(id);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (nodeId) {
      history.pushState(null, "", "/");
      setNodeId(null);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 200);
  }

  const allHits = state.status === "done" ? state.hits : [];
  const hits = activeScope
    ? allHits.filter((h) => h.doc_no === activeScope.doc_no || h.doc_no.startsWith(activeScope.doc_no + "."))
    : allHits;
  const isSearching = state.status === "searching";

  return (
    <div
      className="flex flex-col"
      style={{ background: "var(--bg)", height: "100dvh" }}
    >
      {/* Search bar */}
      <header
        className="shrink-0 px-4 pt-3 pb-2 border-b"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      >
        <div className="max-w-2xl mx-auto lg:max-w-none flex items-center gap-2">
          <a href="/" className="shrink-0" title="Home">
            <img src="/icon-SMALL.png" alt="Home" className="w-7 h-7 object-cover rounded-[30%]" />
          </a>

          <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: "var(--gray)" }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={handleChange}
            placeholder={ready ? "Search the Sky Atlas…" : "Loading index…"}
            disabled={!ready}
            className="w-full pl-9 pr-4 py-2 text-sm rounded border disabled:opacity-40 disabled:cursor-wait focus:outline-none"
            style={{
              background: "var(--surface)",
              color: "var(--tan)",
              borderColor: "var(--border)",
              fontFamily: "inherit",
            }}
            onFocus={e => (e.target.style.borderColor = "var(--accent)")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")}
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono" style={{ color: "var(--gray)" }}>
              searching…
            </span>
          )}
          </div>
        </div>

        {/* Scope filter pills */}
        {scopes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 max-w-2xl mx-auto lg:max-w-none pl-9">
            {scopes.map((s) => {
              const active = activeScope?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveScope(active ? null : s)}
                  className="mono text-xs px-2 py-0.5 rounded border transition-colors"
                  style={{
                    background: active ? "var(--red-dim)" : "var(--surface)",
                    color: active ? "var(--tan)" : "var(--tan-3)",
                    borderColor: active ? "var(--red)" : "var(--border)",
                    boxShadow: active ? "inset 2px 0 0 var(--red)" : undefined,
                  }}
                  onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--tan-2)"; }}}
                  onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--tan-3)"; }}}
                  title={s.title}
                >
                  {s.doc_no}
                </button>
              );
            })}
            {activeScope && (
              <span className="text-xs self-center ml-1" style={{ color: "var(--tan-3)" }}>
                {activeScope.title}
              </span>
            )}
          </div>
        )}
      </header>

      {/* Node detail — fills remaining height, panels scroll independently */}
      {nodeId ? (
        <div className="flex-1 overflow-hidden flex">
          <NodeDetail id={nodeId} onNavigate={navigate} />
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full">
            {state.status === "done" && (
              <div
                className="px-4 py-2 text-xs border-b mono"
                style={{ color: "var(--tan-3)", borderColor: "var(--border)" }}
              >
                {hits.length === 0
                  ? `no results for "${state.query}"${activeScope ? ` in ${activeScope.doc_no}` : ""}`
                  : `${hits.length}${allHits.length !== hits.length ? ` of ${allHits.length}` : ""} result${hits.length !== 1 ? "s" : ""}${activeScope ? ` in ${activeScope.doc_no}` : ""} · ${state.durationMs.toFixed(0)}ms`}
              </div>
            )}
            {hits.length > 0 && (
              <ul>
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <SearchResult hit={hit} onNavigate={navigate} />
                  </li>
                ))}
              </ul>
            )}
            {state.status === "idle" && (
              <SearchHints onSearch={(q) => { setQuery(q); search(q); }} />
            )}
            {state.status === "loading" && (
              <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--gray)" }}>
                Loading search index…
              </div>
            )}
            {state.status === "error" && (
              <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--red)" }}>
                {state.message}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
