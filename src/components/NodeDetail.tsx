import { useState, useEffect } from "react";
import { Breadcrumbs } from "./Breadcrumbs";
import { ScopeNode } from "./ScopeNode";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState, type ChainValue } from "../lib/chainstate";
import { getEdges, type EdgeResult } from "../lib/graph";
import { setAddressMap } from "../lib/addressMap";
import { type AtlasNode, type AddressInfo } from "../types";

// Extract UUIDs from markdown links in content: [text](uuid)
const UUID_LINK_RE = /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

function extractLinkedIds(node: AtlasNode): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of node.content.matchAll(UUID_LINK_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

function buildAncestors(docs: Record<string, AtlasNode>, docNoToId: Map<string, string>, nodeId: string): AtlasNode[] {
  const node = docs[nodeId];
  if (!node || node.doc_no.startsWith("NR-")) return [];
  const ancestors: AtlasNode[] = [];
  const parts = node.doc_no.split(".");
  for (let i = 2; i < parts.length; i++) {
    const ancestorDocNo = parts.slice(0, i).join(".");
    const aid = docNoToId.get(ancestorDocNo);
    if (aid && docs[aid]) ancestors.push(docs[aid]);
  }
  return ancestors;
}

interface DetailState {
  loaded: boolean;
  ancestors: AtlasNode[];
  scopeNodes: AtlasNode[];
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  graphEdges: EdgeResult;
}

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };
const INITIAL: DetailState = { loaded: false, ancestors: [], scopeNodes: [], linkedNodes: [], targetAddresses: {}, chainValues: {}, graphEdges: EMPTY_EDGES };

// Hoisted constant styles
const GRID_STYLE: React.CSSProperties = { minHeight: 0, overflow: "hidden" };
const LEFT_PANE_STYLE: React.CSSProperties = { borderRight: "1px solid var(--border)" };

export function NodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [state, setState] = useState<DetailState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAtlas(), loadAddresses(), loadChainState(), getEdges(id)]).then(([{ docs, byParent, docNoToId }, addresses, chainState, graphEdges]) => {
      if (cancelled) return;

      // Push the shared address map into NodeContent's module-level lookup so
      // its rehype plugin can resolve explorer URLs. Idempotent.
      setAddressMap(addresses);

      const target = docs[id];
      if (!target) { setState({ ...INITIAL, loaded: true }); return; }

      const ancestors = buildAncestors(docs, docNoToId, id);
      const parent = target.parentId ? docs[target.parentId] ?? null : null;

      // Siblings: same parentId, already sorted by `order` in the prebuilt index.
      const siblings = byParent.get(target.parentId) ?? [];
      const idx = siblings.indexOf(target);
      const above = idx > 0 ? siblings.slice(0, idx) : [];
      const below = idx >= 0 ? siblings.slice(idx + 1) : [];

      // Direct children of target — also pre-sorted.
      const children = byParent.get(target.id) ?? [];

      // Display order: parent → above siblings → target → children → below siblings
      const scopeNodes: AtlasNode[] = [];
      if (parent) scopeNodes.push(parent);
      scopeNodes.push(...above, target, ...children, ...below);

      const linkedNodes = extractLinkedIds(target)
        .map((lid) => docs[lid])
        .filter((n): n is AtlasNode => !!n);

      // Join target's addressRefs against the shared address map and chain state
      const targetAddresses: Record<string, AddressInfo> = {};
      const chainValues: Record<string, Record<string, ChainValue>> = {};
      for (const ref of target.addressRefs ?? []) {
        const info = addresses[ref];
        if (info) targetAddresses[ref] = info;
        const cv = chainState.values[ref];
        if (cv) chainValues[ref] = cv;
      }

      setState({ loaded: true, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues, graphEdges });
    });
    return () => { cancelled = true; };
  }, [id]);

  const { loaded, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues, graphEdges } = state;

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 text-sm" style={{ color: "var(--gray)" }}>
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

  const addressCount = Object.keys(targetAddresses).length;

  // Inbound cites — backlinks (new via graph)
  const citedBy = graphEdges.inbound.filter(e => e.e === "cites");

  // Non-cites, non-parent outbound edges — structural relationships
  const HIDE = new Set(["cites", "parent_of", "mentions", "proxies_to"]);
  const outRels = graphEdges.outbound.filter(e => !HIDE.has(e.e));
  const inRels  = graphEdges.inbound.filter(e => !HIDE.has(e.e) && e.e !== "cites");
  const graphRels = [...outRels, ...inRels];

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      <Breadcrumbs ancestors={ancestors} onNavigate={onNavigate} />

      {/* Content grid */}
      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={GRID_STYLE}>
      {/* Left — context */}
      <div className="overflow-y-auto" style={LEFT_PANE_STYLE}>
        <div className="mx-auto px-4 py-6">
          {scopeNodes.map((node) => (
            <ScopeNode key={node.id} node={node} isTarget={node.id === id} onNavigate={onNavigate} />
          ))}
        </div>
      </div>

      {/* Right — annotations: linked nodes on top, addresses below */}
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
            <p className="text-xs mono" style={{ color: "var(--tan-3)" }}>
              annotations · doesn't explicitly link to any documents
            </p>
          )}

          {citedBy.length > 0 && (
            <div className="mt-8">
              <p className="text-xs mono mb-3" style={{ color: "var(--tan-3)" }}>
                cited by · {citedBy.length}
              </p>
              <div className="space-y-1">
                {citedBy.map((e, i) => {
                  // e.f is the citing doc id — resolve title from scopeNodes or navigate
                  const srcDocNo = e.s?.[0] ?? e.f;
                  return (
                    <button
                      key={i}
                      className="w-full text-left px-2 py-1.5 rounded text-xs mono hover:bg-hover transition-colors"
                      style={{ color: "var(--tan-2)" }}
                      onClick={() => onNavigate(e.f)}
                    >
                      {srcDocNo}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {graphRels.length > 0 && (
            <div className="mt-8">
              <p className="text-xs mono mb-3" style={{ color: "var(--tan-3)" }}>
                relations · {graphRels.length}
              </p>
              <div className="space-y-2">
                {graphRels.map((e, i) => {
                  const isOut = outRels.includes(e);
                  const otherId   = isOut ? e.t : e.f;
                  const otherType = isOut ? e.tt : e.ft;
                  const otherLabel = isOut
                    ? (e.to_label ?? otherId.slice(0, 8))
                    : (e.from_label ?? otherId.slice(0, 8));
                  const sources = e.s ?? [];
                  return (
                    <div key={i} className="text-xs border-b pb-2" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--surface)", color: "var(--accent)" }}>
                          {e.e}
                        </span>
                        {!isOut && <span className="text-[10px] mono" style={{ color: "var(--gray)" }}>←</span>}
                        {otherType === "doc" ? (
                          <button
                            className="mono hover:underline text-left"
                            style={{ color: "var(--tan-2)" }}
                            onClick={() => onNavigate(otherId)}
                          >
                            {otherLabel}
                          </button>
                        ) : (
                          <span className="font-medium" style={{ color: "var(--tan)" }}>{otherLabel}</span>
                        )}
                      </div>
                      {sources.length > 0 && (
                        <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
                          source: {sources.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {addressCount > 0 && (
            <div className="mt-8">
              <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                addresses · {addressCount}
              </p>
              {Object.entries(targetAddresses).map(([address, info]) => (
                <AddressCard key={address} address={address} info={info} chainValues={chainValues[address]} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
