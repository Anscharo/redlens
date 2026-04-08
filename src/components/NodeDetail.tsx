import { useState, useEffect } from "react";
import { ScopeNode } from "./ScopeNode";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { loadDocs } from "../lib/docs";
import type { AtlasNode, AddressInfo } from "../types";

// Extract UUIDs from markdown links in content: [text](uuid)
const UUID_LINK_RE = /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

function extractLinkedIds(nodes: AtlasNode[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of nodes) {
    for (const m of node.content.matchAll(UUID_LINK_RE)) {
      if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    }
  }
  return ids;
}

export function NodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [scopeNodes, setScopeNodes] = useState<AtlasNode[]>([]);
  const [linkedNodes, setLinkedNodes] = useState<AtlasNode[]>([]);
  const [targetAddresses, setTargetAddresses] = useState<Record<string, AddressInfo>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadDocs()
      .then((docs) => {
        const target = docs[id];
        if (!target) { setLoaded(true); return; }

        const parent = target.parentId ? docs[target.parentId] ?? null : null;

        // Immediate siblings (same parentId, excluding target itself)
        const siblings = Object.values(docs)
          .filter((n) => n.parentId === target.parentId && n.id !== target.id)
          .sort((a, b) => a.order - b.order);
        const above = siblings.filter((n) => n.order < target.order).slice(-8);
        const below = siblings.filter((n) => n.order > target.order).slice(0, 8);

        // Direct children of target
        const children = Object.values(docs)
          .filter((n) => n.parentId === target.id)
          .sort((a, b) => a.order - b.order)
          .slice(0, 8);

        // Display order: parent → above siblings → target → children → below siblings
        const nodes: AtlasNode[] = [];
        if (parent) nodes.push(parent);
        nodes.push(...above, target, ...children, ...below);

        const linkedIds = extractLinkedIds([target]);
        const linked = linkedIds.map((lid) => docs[lid]).filter((n): n is AtlasNode => !!n);

        setScopeNodes(nodes);
        setLinkedNodes(linked);
        setTargetAddresses(target.addresses ?? {});
        setLoaded(true);
      });
  }, [id]);

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
                <AddressCard key={address} address={address} info={info} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
