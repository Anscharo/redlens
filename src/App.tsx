import { useState, useEffect, useRef, useCallback } from "react";
import { useSearch } from "./hooks/useSearch";
import { useScopes } from "./hooks/useScopes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/AtlasView";
import { TreeSidebar } from "./components/TreeSidebar";
import { prefetchNodeContent } from "./components/NodeContent";
import type { AtlasNode } from "./types";

// ---------------------------------------------------------------------------
// Dev shortcuts — type __dev <cmd> in the search box
// ---------------------------------------------------------------------------

const DEV_SHORTCUTS = [
  {
    cmd: "deep",
    label: "Deepest node",
    hint: "A.6.1.1.1.2.6.1.2.2.1.2.1.2.1.1.3.1 · Encode Mint Function Call",
    id: "c7b2c565-d1b5-4239-9139-89762423443d",
  },
  {
    cmd: "notes",
    label: "Most annotated node",
    hint: "A.1.9.5.2.3.1 · The Core Facilitator Role In Standby Spells · 5 linked nodes",
    id: "50d68397-c09d-4f82-9e8b-44c2bcc30fd7",
  },
  {
    cmd: "history",
    label: "Most-edited node",
    hint: "A.1.5.1.5.0.6.1 · Current Aligned Delegates · 7 changes",
    id: "5f584db8-f8d8-4118-988c-b2bc3f68ceb7",
  },
];

function DevPanel({ query, onNavigate }: { query: string; onNavigate: (id: string) => void }) {
  const lower = query.slice("__dev".length).trim().toLowerCase();
  const matches = lower
    ? DEV_SHORTCUTS.filter(s => s.cmd.startsWith(lower))
    : DEV_SHORTCUTS;

  if (matches.length === 0) return null;

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <p className="mono text-[10px] mb-4 text-tan-3">dev shortcuts</p>
      <div className="space-y-1">
        {matches.map(s => (
          <button
            key={s.cmd}
            onClick={() => onNavigate(s.id)}
            className="hint-row w-full text-left px-3 py-2 rounded flex items-baseline gap-4"
          >
            <span className="mono text-xs shrink-0 w-20 text-accent">__{s.cmd}</span>
            <span className="text-xs font-medium shrink-0 text-tan">{s.label}</span>
            <span className="mono text-[10px] truncate text-tan-3">{s.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const { state, search, ready } = useSearch();
  const scopes = useScopes();
  const [query, setQuery] = useState("");
  const [activeScope, setActiveScope] = useState<AtlasNode | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("id")
  );
  const [view, setView] = useState<"annotations" | "history">(
    () => new URLSearchParams(window.location.search).get("view") === "history" ? "history" : "annotations"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [atlasEverShown, setAtlasEverShown] = useState(!!nodeId);

  useEffect(() => { if (nodeId && !atlasEverShown) setAtlasEverShown(true); }, [nodeId, atlasEverShown]);

  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      setNodeId(params.get("id"));
      setView(params.get("view") === "history" ? "history" : "annotations");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => { prefetchNodeContent(); }, []);

  useEffect(() => {
    if (!nodeId) inputRef.current?.focus();
  }, [nodeId]);

  const navigate = useCallback((id: string) => {
    history.pushState(null, "", `${import.meta.env.BASE_URL}?id=${id}`);
    setNodeId(id);
    setView("annotations");
  }, []);

  const handleViewChange = useCallback((v: "annotations" | "history") => {
    const params = new URLSearchParams(window.location.search);
    if (v === "history") {
      params.set("view", "history");
    } else {
      params.delete("view");
    }
    history.pushState(null, "", `${import.meta.env.BASE_URL}?${params}`);
    setView(v);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (nodeId) {
      history.pushState(null, "", import.meta.env.BASE_URL);
      setNodeId(null);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 200);
  }, [nodeId, search]);

  const toggleScope = useCallback((scope: AtlasNode) => {
    setActiveScope((prev) => (prev?.id === scope.id ? null : scope));
    if (nodeId) {
      history.pushState(null, "", import.meta.env.BASE_URL);
      setNodeId(null);
    }
  }, [nodeId]);

  const handleHintClick = useCallback((q: string) => {
    setQuery(q);
    search(q);
  }, [search]);

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>

      <SearchBar
        inputRef={inputRef}
        query={query}
        onChange={handleChange}
        ready={ready}
        isSearching={state.status === "searching"}
        scopes={scopes}
        activeScope={activeScope}
        onToggleScope={toggleScope}
      />

      <div className="flex-1 flex overflow-hidden">
        <TreeSidebar nodeId={nodeId} onNavigate={navigate} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {!nodeId && query.startsWith("__dev") && (
            <DevPanel query={query} onNavigate={navigate} />
          )}
          {!nodeId && !query.startsWith("__dev") && (
            <SearchResults
              state={state}
              activeScope={activeScope}
              onNavigate={navigate}
              onHintClick={handleHintClick}
            />
          )}
          {atlasEverShown && (
            <div className="flex-1 flex flex-col overflow-hidden" style={{ display: nodeId ? undefined : "none" }}>
              <AtlasView id={nodeId!} onNavigate={navigate} view={view} onViewChange={handleViewChange} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
