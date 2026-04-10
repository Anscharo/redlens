import { useState, useEffect } from "react";
import { ScopeNode } from "./ScopeNode";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState, type ChainValue } from "../lib/chainstate";
import { setAddressMap } from "./NodeContent";
import { realDepth, type AtlasNode, type AddressInfo } from "../types";

// --- Breadcrumb helpers ---

const STOP_WORDS = /\b(the|a|of|an|and|or|for|in|on|to|at|by|with|from)\b/gi;

const ABBREVIATIONS: Record<string, string> = {
  directory: "Dir.",
  directories: "Dirs.",
  document: "Doc.",
  documents: "Docs.",
  configuration: "Config.",
  specification: "Spec.",
  specifications: "Specs.",
  controller: "Ctrl.",
  controllers: "Ctrls.",
  primitives: "Prims.",
  primitive: "Prim.",
  instances: "Inst.",
  instance: "Inst.",
  artifacts: "Artfcts.",
  properties: "Props.",
  property: "Prop.",
  governance: "Gov.",
  definition: "Def.",
  definitions: "Defs.",
};

function shortenTitle(title: string, deep: boolean): string {
  // Drop stop words
  let t = title.replace(STOP_WORDS, "").replace(/\s{2,}/g, " ").trim();
  // Abbreviate at most 50% of words (longest first for max savings)
  const words = t.split(" ");
  const maxAbbrev = Math.floor(words.length / 2);
  let abbrCount = 0;
  // Build list of abbreviable indices sorted by word length desc
  const candidates = words
    .map((w, i) => ({ i, w, abbr: ABBREVIATIONS[w.toLowerCase()] }))
    .filter((c) => c.abbr)
    .sort((a, b) => b.w.length - a.w.length);
  for (const c of candidates) {
    if (abbrCount >= maxAbbrev) break;
    words[c.i] = c.abbr;
    abbrCount++;
  }
  t = words.join(" ");
  // Always cap length; tighter when deep (>6 levels)
  const max = deep ? 18 : 32;
  if (t.length > max) {
    t = t.slice(0, max - 1) + "…";
  }
  return t;
}

function buildAncestors(docs: Record<string, AtlasNode>, nodeId: string): AtlasNode[] {
  const ancestors: AtlasNode[] = [];
  let cur = docs[nodeId];
  while (cur?.parentId) {
    const parent = docs[cur.parentId];
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }
  return ancestors;
}

function depthColor(depth: number): string {
  if (depth <= 1) return "var(--depth-1)";
  if (depth >= 17) return "var(--depth-17)";
  return `var(--depth-${depth})`;
}

// --- End breadcrumb helpers ---

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

interface DetailState {
  loaded: boolean;
  ancestors: AtlasNode[];
  scopeNodes: AtlasNode[];
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
}

const INITIAL: DetailState = { loaded: false, ancestors: [], scopeNodes: [], linkedNodes: [], targetAddresses: {}, chainValues: {} };

export function NodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [state, setState] = useState<DetailState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAtlas(), loadAddresses(), loadChainState()]).then(([{ docs, byParent }, addresses, chainState]) => {
      if (cancelled) return;

      // Push the shared address map into NodeContent's module-level lookup so
      // its rehype plugin can resolve explorer URLs. Idempotent.
      setAddressMap(addresses);

      const target = docs[id];
      if (!target) { setState({ ...INITIAL, loaded: true }); return; }

      const ancestors = buildAncestors(docs, id);
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

      setState({ loaded: true, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues });
    });
    return () => { cancelled = true; };
  }, [id]);

  const { loaded, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues } = state;

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

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {/* Breadcrumb — fixed strip below search bar */}
      {ancestors.length > 0 && (
        <nav
          className="flex flex-wrap items-center gap-x-1 text-xs mono"
          style={{ color: "var(--tan-3)", paddingLeft: 30, paddingRight: 16, paddingTop: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)", background: "var(--bg)" }}
        >
          {ancestors.map((a, i) => {
            const deep = ancestors.length > 6;
            return (
              <span key={a.id} className="flex items-center gap-x-1">
                {i > 0 && <span style={{ color: "var(--tan-3)" }}>/</span>}
                <a
                  href={`${import.meta.env.BASE_URL}?id=${a.id}`}
                  onClick={(e) => { e.preventDefault(); onNavigate(a.id); }}
                  className="breadcrumb-link"
                  style={{ "--crumb-color": depthColor(realDepth(a.doc_no)) } as React.CSSProperties}
                >
                  <span className="short">{shortenTitle(a.title, deep)}</span>
                  <span className="full">{a.title}</span>
                </a>
              </span>
            );
          })}
        </nav>
      )}

      {/* Content grid */}
      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={{ minHeight: 0, overflow: "hidden" }}>
      {/* Left — context */}
      <div className="overflow-y-auto" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="max-w-2xl mx-auto px-4 py-6">
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
              annotations · no linked nodes
            </p>
          )}

          {Object.keys(targetAddresses).length > 0 && (
            <div className="mt-8">
              <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                addresses · {Object.keys(targetAddresses).length}
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
