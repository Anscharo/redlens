import { useState, useEffect, useRef, useCallback } from "react";
import { useSearch } from "./hooks/useSearch";
import { useScopes } from "./hooks/useScopes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { NodeDetail } from "./components/NodeDetail";
import type { AtlasNode } from "./types";

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

  const navigate = useCallback((id: string) => {
    history.pushState(null, "", `${import.meta.env.BASE_URL}?id=${id}`);
    setNodeId(id);
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
  }, []);

  const handleHintClick = useCallback((q: string) => {
    setQuery(q);
    search(q);
  }, [search]);

  return (
    <div
      className="flex flex-col"
      style={{ background: "var(--bg)", height: "100dvh" }}
    >
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

      {nodeId ? (
        <div className="flex-1 overflow-hidden flex">
          <NodeDetail id={nodeId} onNavigate={navigate} />
        </div>
      ) : (
        <SearchResults
          state={state}
          activeScope={activeScope}
          onNavigate={navigate}
          onHintClick={handleHintClick}
        />
      )}
    </div>
  );
}
