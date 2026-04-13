import { useState, useEffect, useMemo, useCallback, memo, startTransition } from "react";
import { Breadcrumbs } from "./Breadcrumbs";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { NodeHistory } from "./NodeHistory";
import { NodeContent } from "./NodeContent";
import { loadAtlas, type AtlasBundle } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState, type ChainValue } from "../lib/chainstate";
import { setAddressMap } from "../lib/addressMap";
import { realDepth, depthColor, type AtlasNode, type AddressInfo } from "../types";

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

// Pre-computed per-node values so CollapsibleNode doesn't recompute on every render
interface FlatEntry {
  node: AtlasNode;
  depth: number;
  color: string;
  indentPadding: number;
  hasContent: boolean;
}

function flattenTree(byParent: Map<string | null, AtlasNode[]>): FlatEntry[] {
  const result: FlatEntry[] = [];
  function walk(parentId: string | null) {
    for (const node of byParent.get(parentId) ?? []) {
      const depth = realDepth(node.doc_no);
      result.push({
        node,
        depth,
        color: depthColor(depth),
        indentPadding: (depth - 1) * 6,
        hasContent: !!node.content,
      });
      walk(node.id);
    }
  }
  walk(null);
  return result;
}

// Hoisted styles
const GRID_STYLE: React.CSSProperties = { minHeight: 0, overflow: "hidden" };
const LEFT_PANE_STYLE: React.CSSProperties = { borderRight: "1px solid var(--border)" };

// (A) Stable empty Set — reused on every navigation reset to avoid extra render
const EMPTY_SET: Set<string> = new Set();

interface LoadedData {
  atlas: AtlasBundle;
  flatNodes: FlatEntry[];
  addresses: Record<string, AddressInfo>;
  chainState: { values: Record<string, Record<string, ChainValue>> };
}

export function AtlasView({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());

  // Load data once — wrap in startTransition so the loading state shows
  // immediately while React mounts ~10K nodes in the background.
  useEffect(() => {
    Promise.all([loadAtlas(), loadAddresses(), loadChainState()]).then(([atlas, addresses, chainState]) => {
      setAddressMap(addresses);
      startTransition(() => {
        setData({ atlas, flatNodes: flattenTree(atlas.byParent), addresses, chainState });
      });
    });
  }, []);

  // (A) Reset user toggles on navigation — stable ref avoids extra render
  useEffect(() => { setUserToggles(EMPTY_SET); }, [id]);

  // Auto-expanded nodes: target + parent + all siblings
  const autoExpanded = useMemo(() => {
    if (!data || !id) return new Set<string>();
    const { docs, byParent } = data.atlas;
    const target = docs[id];
    if (!target) return new Set<string>();

    const set = new Set<string>();
    set.add(id);
    if (target.parentId && docs[target.parentId]) set.add(target.parentId);
    for (const sib of byParent.get(target.parentId) ?? []) set.add(sib.id);
    return set;
  }, [data, id]);

  // Breadcrumbs for selected node
  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestors(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  // Annotations for selected node (right panel)
  const { linkedNodes, targetAddresses, chainValues } = useMemo(() => {
    const empty = { linkedNodes: [] as AtlasNode[], targetAddresses: {} as Record<string, AddressInfo>, chainValues: {} as Record<string, Record<string, ChainValue>> };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id];
    if (!target) return empty;

    const linkedNodes = extractLinkedIds(target)
      .map(lid => docs[lid])
      .filter((n): n is AtlasNode => !!n);

    const targetAddresses: Record<string, AddressInfo> = {};
    const cv: Record<string, Record<string, ChainValue>> = {};
    for (const ref of target.addressRefs ?? []) {
      const info = data.addresses[ref];
      if (info) targetAddresses[ref] = info;
      const val = data.chainState.values[ref];
      if (val) cv[ref] = val;
    }

    return { linkedNodes, targetAddresses, chainValues: cv };
  }, [data, id]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Scroll to target on navigation
  useEffect(() => {
    if (id && data) {
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    }
  }, [id, data]);

  // (C) Memoize the 10K node list — only re-evaluates when selection or expansion changes
  // Must be before early returns so hook order is stable.
  const nodeList = useMemo(() =>
    data ? data.flatNodes.map(entry => (
      <CollapsibleNode
        key={entry.node.id}
        entry={entry}
        isSelected={entry.node.id === id}
        isExpanded={autoExpanded.has(entry.node.id) !== userToggles.has(entry.node.id)}
        onNavigate={onNavigate}
        onToggle={handleToggle}
      />
    )) : null,
    [data, id, autoExpanded, userToggles, onNavigate, handleToggle]
  );

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 text-sm" style={{ color: "var(--gray)" }}>
        Loading…
      </div>
    );
  }

  if (id && !data.atlas.docs[id]) {
    return (
      <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--red)" }}>
        Node not found: {id}
      </div>
    );
  }

  const addressCount = Object.keys(targetAddresses).length;

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {id && <Breadcrumbs ancestors={ancestors} onNavigate={onNavigate} />}

      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={GRID_STYLE}>
        {/* Left — full atlas tree */}
        <div className="overflow-y-auto" style={LEFT_PANE_STYLE}>
          <div className="max-w-2xl mx-auto px-4 py-2">
            {nodeList}
          </div>
        </div>

        {/* Right — annotations */}
        {id && (
          <div className="overflow-y-auto hidden lg:block">
            <div className="px-4 py-6">
              {linkedNodes.length > 0 ? (
                <>
                  <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                    annotations · {linkedNodes.length} linked node{linkedNodes.length !== 1 ? "s" : ""}
                  </p>
                  {linkedNodes.map(node => (
                    <RelatedNode key={node.id} node={node} onNavigate={onNavigate} />
                  ))}
                </>
              ) : (
                <p className="text-xs mono" style={{ color: "var(--tan-3)" }}>
                  annotations · no linked nodes
                </p>
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

              <div className="mt-8">
                <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>history</p>
                <NodeHistory nodeId={id} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- CollapsibleNode ---

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-bold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-semibold",
  7: "text-sm font-medium",
  8: "text-sm font-medium",
  9: "text-xs font-medium",
  10: "text-xs font-medium",
  11: "text-xs font-normal",
  12: "text-xs font-normal",
};

const BORDER_WIDTH = 3;

const CollapsibleNode = memo(function CollapsibleNode({
  entry,
  isSelected,
  isExpanded,
  onNavigate,
  onToggle,
}: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  onNavigate: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  // (B) depth, color, indentPadding, hasContent pre-computed at flatten time
  const { node, depth, color, indentPadding, hasContent } = entry;

  return (
    <div
      id={node.id}
      className="atlas-node relative"
      style={{
        padding: 4,
        boxShadow: isSelected ? `inset ${BORDER_WIDTH}px 0 0 ${color}` : undefined,
        scrollMarginTop: "64px",
      }}
    >
      {/* Depth dots — fixed positions so each level aligns across all nodes */}
      {depth > 1 && (
        <span className="absolute flex items-center" style={{ left: BORDER_WIDTH+ 2, top: 1 }}>
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} style={{ width:4, textAlign: "center", color: depthColor(i + 1), fontSize: i === depth -1 ?  11 : 8, lineHeight: 1 }}>{"\u2022"}</span>
          ))}
        </span>
      )}
      {/* Title bar — always visible */}
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: isSelected ? indentPadding - BORDER_WIDTH: indentPadding}}
      >
      {/* Toggle chevron */}
        <span
          role={hasContent ? "button" : undefined}
          tabIndex={hasContent ? 0 : undefined}
          aria-expanded={hasContent ? isExpanded : undefined}
          aria-label={hasContent ? `Toggle ${node.title}` : undefined}
          className="atlas-toggle text-[11px] w-3 text-center shrink-0"
          style={{ color: hasContent ? "var(--tan-3)" : "transparent", display: "inline-flex" }}
          onClick={hasContent ? (e: React.MouseEvent) => { e.stopPropagation(); onToggle(node.id); } : undefined}
          onKeyDown={hasContent ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggle(node.id); } } : undefined}
        >
          {hasContent ? (isExpanded ? "\u25BE" : "\u25B8") : "\u00B7"}
        </span>
      <div
        role="button"
        tabIndex={0}
        className="atlas-node-title flex items-center gap-2 py-1.5 cursor-pointer"
        onClick={() => onNavigate(node.id)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(node.id); } }}
      >
        <span
          className={DEPTH_HEADING[depth] ?? "text-sm font-medium"}
          style={{ color: isSelected ? "var(--tan)" : "var(--tan-2)" }}
        >
          {node.title}
        </span>
        <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{node.id}</span>
      </div>
      </div>

      {/* Expanded content */}
      {isExpanded && hasContent && (
        <div className="pb-3 mt-2"
        style={{paddingLeft: (isSelected ? indentPadding - BORDER_WIDTH: indentPadding) + 24}}
        
        >
          <div className="flex items-center gap-3 mb-2">  
            <span
              className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
              style={{ background: "var(--surface)", color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)` }}
            >
              {node.type}
            </span>
            <span className="mono text-[10px] shrink-0" style={{ color }}>{node.doc_no}</span>
            <a
              href={`https://sky-atlas.io/#${node.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="atlas-external-link shrink-0"
              onClick={e => e.stopPropagation()}
              title="Open on Sky Atlas"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4.5 1.5H2a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V7.5" />
                <path d="M7 1.5h3.5V5M7 5.5l4-4" />
              </svg>
            </a>
          </div>
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
