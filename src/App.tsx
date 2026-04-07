import { useState, useEffect, useRef } from "react";
import { useSearch } from "./hooks/useSearch";
import { SearchResult } from "./components/SearchResult";
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

function ScopeNode({ node, isTarget }: { node: AtlasNode; isTarget: boolean }) {
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
      className={[
        "py-4 border-b",
        DEPTH_INDENT[node.depth] ?? "pl-16",
      ].join(" ")}
      style={{
        borderColor: "var(--border)",
        backgroundColor: isTarget ? "var(--red-dim)" : undefined,
        marginLeft: isTarget ? "-1rem" : undefined,
        paddingLeft: isTarget ? `calc(${["0","0","1rem","2rem","3rem","4rem"][node.depth - 1] ?? "4rem"} + 1rem)` : undefined,
        boxShadow: isTarget ? "inset 3px 0 0 var(--red)" : undefined,
        scrollMarginTop: "64px",
      }}
    >
      <p
        className={`mb-1 ${DEPTH_HEADING[node.depth] ?? "text-sm font-medium"}`}
        style={{ color: isTarget ? "var(--tan)" : "var(--tan)" }}
      >
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-3">
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
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--tan-2)" }}>
          {node.content}
        </p>
      )}
    </div>
  );
}

function NodeDetail({ id }: { id: string }) {
  const [scopeNodes, setScopeNodes] = useState<AtlasNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/docs.json")
      .then((r) => r.json())
      .then((docs: Record<string, AtlasNode>) => {
        const target = docs[id];
        if (!target) { setLoaded(true); return; }

        const parent = target.parentId ? (docs[target.parentId] ?? target) : target;
        const prefix = parent.doc_no + ".";
        const nodes = Object.values(docs).filter(
          (n) => n.id === parent.id || n.doc_no.startsWith(prefix)
        );
        nodes.sort((a, b) => a.order - b.order);

        setScopeNodes(nodes);
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
    <div className="max-w-2xl mx-auto px-4 py-6">
      {scopeNodes.map((node) => (
        <ScopeNode key={node.id} node={node} isTarget={node.id === id} />
      ))}
    </div>
  );
}

export default function App() {
  const { state, search, ready } = useSearch();
  const [query, setQuery] = useState("");
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

  const hits = state.status === "done" ? state.hits : [];
  const isSearching = state.status === "searching";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Search bar */}
      <header
        className="sticky top-0 z-10 px-4 py-3 border-b"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      >
        <div className="max-w-2xl mx-auto relative">
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
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono"
              style={{ color: "var(--gray)" }}
            >
              searching…
            </span>
          )}
        </div>
      </header>

      {/* Node detail view */}
      {nodeId ? (
        <main className="flex-1">
          <NodeDetail id={nodeId} />
        </main>
      ) : (
        <main className="flex-1 max-w-2xl mx-auto w-full">
          {state.status === "done" && (
            <div
              className="px-4 py-2 text-xs border-b mono"
              style={{ color: "var(--tan-3)", borderColor: "var(--border)" }}
            >
              {hits.length === 0
                ? `no results for "${state.query}"`
                : `${hits.length} result${hits.length !== 1 ? "s" : ""} · ${state.durationMs.toFixed(0)}ms`}
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
            <div
              className="flex flex-col items-center justify-center py-24 select-none"
              style={{ color: "var(--tan-3)" }}
            >
              <svg
                className="w-10 h-10 mb-3 opacity-30"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <circle cx={11} cy={11} r={8} />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <p className="text-sm">Search the Sky Atlas</p>
            </div>
          )}

          {state.status === "loading" && (
            <div
              className="flex items-center justify-center py-24 text-sm"
              style={{ color: "var(--gray)" }}
            >
              Loading search index…
            </div>
          )}

          {state.status === "error" && (
            <div
              className="flex items-center justify-center py-24 text-sm"
              style={{ color: "var(--red)" }}
            >
              {state.message}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
