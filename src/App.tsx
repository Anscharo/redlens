import { useState, useEffect, useRef } from "react";
import { useSearch } from "./hooks/useSearch";
import { SearchResult } from "./components/SearchResult";
import type { AtlasNode } from "./types";

// Heading styles by depth
const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold text-slate-900",
  2: "text-xl font-bold text-slate-900",
  3: "text-lg font-semibold text-slate-800",
  4: "text-base font-semibold text-slate-800",
  5: "text-sm font-semibold text-slate-700",
  6: "text-sm font-medium text-slate-700",
};

const DEPTH_INDENT: Record<number, string> = {
  1: "pl-0",
  2: "pl-0",
  3: "pl-4",
  4: "pl-8",
  5: "pl-12",
  6: "pl-16",
};

function ScopeNode({
  node,
  isTarget,
}: {
  node: AtlasNode;
  isTarget: boolean;
}) {
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
        "py-3 border-b border-slate-100",
        DEPTH_INDENT[node.depth] ?? "pl-16",
        isTarget ? "bg-yellow-50 -mx-4 px-4 ring-2 ring-yellow-300 ring-inset rounded" : "",
      ].join(" ")}
    >
      <p className={`mb-1 ${DEPTH_HEADING[node.depth] ?? "text-sm font-medium text-slate-700"}`}>
        {node.title}
      </p>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
          {node.type}
        </span>
        <span className="text-xs font-mono text-slate-400">{node.doc_no}</span>
        <span className="text-[10px] font-mono text-slate-300">{node.id}</span>
      </div>
      {node.content && (
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
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

        // Go one level up (parent), or use the target itself if it's a root
        const parent = target.parentId ? (docs[target.parentId] ?? target) : target;

        // Collect parent + everything under it (A.2.2.2.*)
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
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (scopeNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-red-400 text-sm">
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

  // Sync state with browser back/forward
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
    // Typing clears the detail view and shows results
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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Search bar */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-2xl mx-auto relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none"
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
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50 disabled:cursor-wait"
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 animate-pulse">
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
            <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-100">
              {hits.length === 0
                ? `No results for "${state.query}"`
                : `${hits.length} result${hits.length !== 1 ? "s" : ""} · ${state.durationMs.toFixed(0)} ms`}
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
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 select-none">
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
            <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
              Loading search index…
            </div>
          )}

          {state.status === "error" && (
            <div className="flex items-center justify-center py-24 text-red-500 text-sm">
              {state.message}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
