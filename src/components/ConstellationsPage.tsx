import { useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "wouter";
import { loadAtlas } from "@/lib/docs";
import { useLoaded } from "../hooks/useAtlasData";
import { useConstellationsWorker } from "../hooks/useConstellationsWorker";
import { useUrlState, urlBool, urlString, urlStringSet } from "../hooks/useUrlState";
import {
  buildEntityNodes,
  buildEntityEdges,
  ENTITY_TYPE_LABEL,
  ENTITY_TYPE_COLOR,
  CONNECTED_ENTITY_TYPES,
} from "@/lib/entityGraph";
import { EntityFlow } from "./constellations/EntityFlow";
import { Loading } from "./Loading";
import { ErrorBoundary, PanelError } from "./ErrorBoundary";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { GraphEntity } from "@/types";

const DEFAULT_HIDDEN_TYPES = new Set(["govops_org", "facilitator_org", "delegate_org"]);
const hiddenTypesCodec = urlStringSet(DEFAULT_HIDDEN_TYPES);
const focusCodec = urlString(null);
const filtersOpenCodec = urlBool(true);

export function ConstellationsPage({ query }: { query: string }) {
  useDocumentTitle("Constellations: Sky Atlas by Redline");
  const atlas = useLoaded(loadAtlas);
  const docNoToId = atlas?.docNoToId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlId = searchParams.get("id");

  // Preserve filter params when selecting an entity.
  const selectEntity = useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        const np = new URLSearchParams(prev);
        np.set("id", id);
        return np;
      });
    },
    [setSearchParams],
  );

  const [filtersOpen, setFiltersOpen] = useUrlState("filters", filtersOpenCodec);
  const [hiddenTypes, setHiddenTypes] = useUrlState("hide", hiddenTypesCodec);
  const [focusAgentId, setFocusAgentId] = useUrlState("focus", focusCodec);

  const { init, initError, neighborIds, topId, clusterIds } = useConstellationsWorker(query, focusAgentId);

  useEffect(() => {
    if (topId) selectEntity(topId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId]);

  const graphData = useMemo(
    () =>
      init
        ? {
            participants: init.entities.filter(
              (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
            ),
            instances: init.entities.filter((e) => e.et === "instance"),
            invocations: init.entities.filter((e) => e.et === "invocation"),
            primitives: init.entities.filter((e) => e.et === "primitive"),
            edges: init.entityEdges,
          }
        : null,
    [init],
  );

  const allEntities = useMemo(() => init?.entities ?? [], [init]);

  const allNodes = useMemo(() => (graphData ? buildEntityNodes(graphData) : []), [graphData]);
  const allEdges = useMemo(() => (graphData ? buildEntityEdges(graphData) : []), [graphData]);

  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of allNodes) {
      const subKey = n.entity.et === "instance" && n.entity.st ? `instance:${n.entity.st}` : null;
      if (hiddenTypes.has(n.entity.et)) continue;
      if (subKey && hiddenTypes.has(subKey)) continue;
      if (clusterIds && !clusterIds.has(n.id)) continue;
      if (neighborIds && !neighborIds.has(n.id)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [allNodes, hiddenTypes, neighborIds, clusterIds]);

  const visibleEdgeCount = useMemo(
    () => allEdges.filter((e) => visibleIds.has(e.src) && visibleIds.has(e.tgt)).length,
    [allEdges, visibleIds],
  );

  const typeRows = useMemo(() => {
    const m = new Map<
      string,
      { key: string; et: string; label: string; count: number; color: string }
    >();
    for (const e of allEntities) {
      const key = e.et === "instance" && e.st ? `instance:${e.st}` : e.et;
      const label =
        e.et === "instance" && e.st
          ? e.st.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
          : (ENTITY_TYPE_LABEL[e.et] ?? e.et);
      const color = ENTITY_TYPE_COLOR[e.et] ?? "var(--entity-fallback)";
      const cur = m.get(key);
      if (cur) cur.count++;
      else m.set(key, { key, et: e.et, label, count: 1, color });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [allEntities]);

  const primeAgents = useMemo(
    () =>
      allEntities
        .filter((e) => e.et === "agent" && e.st === "prime")
        .sort((a, b) => a.name.localeCompare(b.name)) as GraphEntity[],
    [allEntities],
  );

  // Surface a graph worker init failure to the route ErrorBoundary rather than
  // spinning "loading constellations" forever (deep review Exec #4/#5). Placed
  // after all hooks so the throw doesn't change the hook call count.
  if (initError) throw initError;

  if (!graphData || !docNoToId) {
    return <Loading>loading constellations</Loading>;
  }

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      <div className="shrink-0 px-1 py-1 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <p className="mono text-[10px] uppercase tracking-wide" style={{ color: "var(--tan-3)" }}>
            {neighborIds
              ? visibleIds.size === 0
                ? `no results for "${query}"`
                : `"${query}" · ${visibleIds.size} shown · ${visibleEdgeCount} relationships`
              : `${allEntities.length} total · ${visibleIds.size} shown · ${visibleEdgeCount} relationships`}
          </p>
          <button
            aria-label="Toggle the filters"
            onClick={() => setFiltersOpen((v) => !v)}
            className="mono text-[25px] leading-none transition-transform duration-150"
            style={{ color: "var(--tan-3)", transform: filtersOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
            title={filtersOpen ? "Hide filters" : "Show filters"}
          >
            ▾
          </button>
        </div>
        {filtersOpen && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <button
              className="mono text-[10px] px-2 py-1 rounded transition-opacity"
              style={{ background: "var(--surface)", color: "var(--tan-3)" }}
              onClick={() => setHiddenTypes(new Set(typeRows.map((r) => r.key)))}
              title="Hide all types"
            >
              none
            </button>
            <button
              className="mono text-[10px] px-2 py-1 rounded transition-opacity"
              style={{ background: "var(--surface)", color: "var(--tan-3)" }}
              onClick={() => setHiddenTypes(new Set())}
              title="Show all types"
            >
              all
            </button>
            {typeRows.map((row) => {
              const hidden = hiddenTypes.has(row.key);
              const connected = CONNECTED_ENTITY_TYPES.has(row.et);
              return (
                <button
                  key={row.key}
                  className="mono text-[10px] px-2 py-1 rounded flex items-center gap-1.5 transition-opacity"
                  style={{
                    background: "var(--surface)",
                    color: hidden ? "var(--tan-3)" : "var(--tan-2)",
                    opacity: hidden ? 0.4 : 1,
                  }}
                  onClick={() => {
                    setHiddenTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.key)) next.delete(row.key);
                      else next.add(row.key);
                      return next;
                    });
                  }}
                  title={connected ? (hidden ? "Show" : "Hide") : "No direct entity-to-entity edges — panel context only"}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: row.color }} />
                  {row.label} · {row.count}
                  {!connected && <span style={{ color: "var(--tan-3)" }}>·</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {filtersOpen && (
        <div
          className="shrink-0 px-4 py-2 border-b flex items-center gap-2 flex-wrap"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="mono text-[10px] uppercase tracking-wide" style={{ color: "var(--tan-3)" }}>
            Focus:
          </span>
          <button
            onClick={() => setFocusAgentId(null)}
            className="mono text-[10px] px-2 py-1 rounded transition-opacity"
            style={{
              background: "var(--surface)",
              color: focusAgentId === null ? "var(--tan)" : "var(--tan-3)",
              opacity: focusAgentId === null ? 1 : 0.6,
              border: focusAgentId === null ? "1px solid var(--accent)" : "1px solid transparent",
            }}
          >
            All
          </button>
          {primeAgents.map((a) => {
            const on = focusAgentId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setFocusAgentId(on ? null : a.id)}
                className="mono text-[10px] px-2 py-1 rounded transition-opacity"
                style={{
                  background: "var(--surface)",
                  color: on ? "var(--tan)" : "var(--tan-3)",
                  opacity: on ? 1 : 0.6,
                  border: on ? "1px solid var(--accent)" : "1px solid transparent",
                }}
                title={on ? "Clear focus" : `Show only ${a.name}'s cluster`}
              >
                {a.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <ErrorBoundary fallback={(error) => <PanelError error={error} />}>
          <EntityFlow
            allNodes={allNodes}
            allEdges={allEdges}
            visibleIds={visibleIds}
            selectedId={urlId}
            onSelect={selectEntity}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
