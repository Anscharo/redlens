import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearch } from "./hooks/useSearch";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { OFReport } from "./components/reports/OFReport";
import { ActiveDataReport } from "./components/reports/ActiveDataReport";
import { ReportsIndex } from "./components/ReportsIndex";
import { EntitiesPage } from "./components/EntitiesPage";
import { SearchHintsPage } from "./components/SearchHints";
import { prefetchNodeContent } from "./components/NodeContent";
import { DevPanel } from "./DevPanel";
import { Footer } from "./components/Footer";

export type ReportId = "of-responsibilities" | "active-data";

prefetchNodeContent();

export default function App() {
  const [location, navigate] = useLocation();
  const { state, search, ready } = useSearch();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // nodeId and view derived reactively from URL search params via wouter
  const [searchParams] = useSearchParams();
  const nodeId = location === "/atlas" ? searchParams.get("id") : null;
  const atlasView = searchParams.get("view") === "history" ? "history" as const : "annotations" as const;

  useEffect(() => {
    if (location === "/" && !nodeId) inputRef.current?.focus();
  }, [location, nodeId]);

  const navigateToNode = useCallback((id: string) => {
    navigate(`/atlas?id=${id}`);
    setQuery(""); search("");
  }, [navigate, search]);

  const navigateToReport = useCallback((id: ReportId) => {
    navigate(`/reports/${id}`);
    setQuery(""); search("");
  }, [navigate, search]);

  const handleViewChange = useCallback((v: "annotations" | "history") => {
    const params = new URLSearchParams();
    if (nodeId) params.set("id", nodeId);
    if (v === "history") params.set("view", "history");
    navigate(`/atlas?${params}`);
  }, [navigate, nodeId]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;

    if (q === "/reports") { navigate("/reports"); setQuery(""); search(""); return; }
    if (q === "/hints")   { navigate("/search-hints"); setQuery(""); search(""); return; }

    setQuery(q);
    if (location !== "/") navigate("/");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.startsWith("/")) {
      search("");
    } else {
      debounceRef.current = setTimeout(() => search(q), 200);
    }
  }, [location, navigate, search]);

  const activeNavPage = location.startsWith("/entities") ? "entities"
    : location.startsWith("/reports") ? "reports"
    : null;

  return (
    <div className="flex flex-col h-dvh" style={{ background: "var(--bg)" }}>
      <SearchBar
        inputRef={inputRef} query={query} onChange={handleChange}
        ready={ready} isSearching={state.status === "searching"}
        onNavPage={(p) => { navigate(`/${p}`); setQuery(""); search(""); }}
        activePage={activeNavPage as "reports" | "entities" | null}
      />
      <div className="flex-1 flex overflow-hidden">
        <TreeSidebar nodeId={nodeId} onNavigate={navigateToNode} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Switch>
            <Route path="/">
              {query.startsWith("__dev")
                ? <DevPanel query={query} onNavigate={navigateToNode} />
                : <SearchResults state={state} query={query} onNavigate={navigateToNode}
                    onHintClick={(q) => { setQuery(q); search(q); }} />
              }
            </Route>
            <Route path="/atlas">
              <AtlasView
                id={nodeId ?? ""}
                onNavigate={navigateToNode}
                view={atlasView}
                onViewChange={handleViewChange}
              />
            </Route>
            <Route path="/reports"><ReportsIndex onNavigate={navigateToReport} /></Route>
            <Route path="/reports/of-responsibilities"><OFReport onNavigate={navigateToNode} /></Route>
            <Route path="/reports/active-data"><ActiveDataReport onNavigate={navigateToNode} /></Route>
            <Route path="/entities"><EntitiesPage onNavigate={navigateToNode} /></Route>
            <Route path="/search-hints"><SearchHintsPage onHintClick={(q) => { navigate("/"); setQuery(q); search(q); }} /></Route>
          </Switch>
        </div>
      </div>
      <Footer />
    </div>
  );
}
