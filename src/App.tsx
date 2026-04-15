import { useState, useEffect, useRef, useCallback } from "react";
import { useSearch } from "./hooks/useSearch";
import { useScopes } from "./hooks/useScopes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { OFReport } from "./components/reports/OFReport";
import { ActiveDataReport } from "./components/reports/ActiveDataReport";
import { prefetchNodeContent } from "./components/NodeContent";
import type { AtlasNode } from "./types";
import { DevPanel } from "./DevPanel";

export type ReportId = "of-responsibilities" | "active-data";

// Start prefetching the markdown chunk immediately during script evaluation,
// rather than waiting for React mount + useEffect. Eliminates one round-trip
// from the LCP waterfall.
prefetchNodeContent();

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
  const [report, setReport] = useState<ReportId | null>(
    () => new URLSearchParams(window.location.search).get("report") as ReportId | null
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
      setReport(params.get("report") as ReportId | null);
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
    setView("annotations");
    setReport(null);
    setQuery("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    search("");
  }, [search]);

  const navigateToReport = useCallback((id: ReportId) => {
    history.pushState(null, "", `${import.meta.env.BASE_URL}?report=${id}`);
    setReport(id);
    setNodeId(null);
    setQuery("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    search("");
  }, [search]);

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
    if (nodeId || report) {
      history.pushState(null, "", import.meta.env.BASE_URL);
      setNodeId(null);
      setReport(null);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 200);
  }, [nodeId, report, search]);

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

  const handleHintReport = useCallback((id: ReportId) => {
    navigateToReport(id);
  }, [navigateToReport]);

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
          {!nodeId && !report && query.startsWith("__dev") && (
            <DevPanel query={query} onNavigate={navigate} />
          )}
          {!nodeId && !report && !query.startsWith("__dev") && (
            <SearchResults
              state={state}
              activeScope={activeScope}
              onNavigate={navigate}
              onHintClick={handleHintClick}
              onReportClick={handleHintReport}
            />
          )}
          {report === "of-responsibilities" && <OFReport onNavigate={navigate} />}
          {report === "active-data" && <ActiveDataReport onNavigate={navigate} />}
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
