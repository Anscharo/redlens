import { useState, useEffect } from "react";
import { ScopeNode } from "./ScopeNode";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState, type ChainValue } from "../lib/chainstate";
import { setAddressMap } from "./NodeContent";
import type { AtlasNode, AddressInfo } from "../types";

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
  scopeNodes: AtlasNode[];
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
}

const INITIAL: DetailState = { loaded: false, scopeNodes: [], linkedNodes: [], targetAddresses: {}, chainValues: {} };

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

      const parent = target.parentId ? docs[target.parentId] ?? null : null;

      // Siblings: same parentId, already sorted by `order` in the prebuilt index.
      // Find target's position with a single linear scan, then slice ±8 around it.
      const siblings = byParent.get(target.parentId) ?? [];
      const idx = siblings.indexOf(target);
      const above = idx > 0 ? siblings.slice(Math.max(0, idx - 8), idx) : [];
      const below = idx >= 0 ? siblings.slice(idx + 1, idx + 9) : [];

      // Direct children of target — also pre-sorted.
      const children = (byParent.get(target.id) ?? []).slice(0, 8);

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

      setState({ loaded: true, scopeNodes, linkedNodes, targetAddresses, chainValues });
    });
    return () => { cancelled = true; };
  }, [id]);

  const { loaded, scopeNodes, linkedNodes, targetAddresses, chainValues } = state;

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
    <div className="flex-1 flex flex-col lg:grid lg:grid-cols-[3fr_2fr]" style={{ minHeight: 0 }}>
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
  );
}
