import { useState, useEffect, useMemo, useCallback, startTransition } from "react";
import { Breadcrumbs } from "../Breadcrumbs";
import { loadAtlas } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadChainState, type ChainValue } from "../../lib/chainstate";
import { setAddressMap } from "../../lib/addressMap";
import { type AtlasNode, type AddressInfo } from "../../types";
import { CollapsibleNode, flattenTree } from "./CollapsibleNode";
import { RightPanel } from "./RightPanel";
import {
  extractLinkedIds, buildAncestors,
  ATLAS_GRID_STYLE, ATLAS_LEFT_PANE_STYLE, ATLAS_EMPTY_SET,
  type LoadedData,
} from "../../lib/atlasHelpers";

export function AtlasView({ id, onNavigate, view, onViewChange }: {
  id: string;
  onNavigate: (id: string) => void;
  view: "annotations" | "history";
  onViewChange: (v: "annotations" | "history") => void;
}) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([loadAtlas(), loadAddresses(), loadChainState()]).then(([atlas, addresses, chainState]) => {
      setAddressMap(addresses);
      startTransition(() => {
        setData({ atlas, flatNodes: flattenTree(atlas.byParent), addresses, chainState });
      });
    });
  }, []);

  useEffect(() => { setUserToggles(ATLAS_EMPTY_SET); }, [id]);

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

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestors(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  const { linkedNodes, targetAddresses, chainValues } = useMemo(() => {
    const empty = { linkedNodes: [] as AtlasNode[], targetAddresses: {} as Record<string, AddressInfo>, chainValues: {} as Record<string, Record<string, ChainValue>> };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id];
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target).map(lid => docs[lid]).filter((n): n is AtlasNode => !!n);
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

  useEffect(() => {
    if (!id || !data) return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
    });
  }, [id, data]);

  const nodeList = useMemo(() => {
    if (!data) return null;
    return data.flatNodes.map(entry => (
      <CollapsibleNode
        key={entry.node.id}
        entry={entry}
        isSelected={entry.node.id === id}
        isExpanded={autoExpanded.has(entry.node.id) !== userToggles.has(entry.node.id)}
        onNavigate={onNavigate}
        onToggle={handleToggle}
      />
    ));
  }, [data, id, autoExpanded, userToggles, onNavigate, handleToggle]);

  if (!data) {
    return <div className="flex-1 flex items-center justify-center py-24 text-sm text-gray">Loading…</div>;
  }
  if (id && !data.atlas.docs[id]) {
    return <div className="flex items-center justify-center py-24 text-sm text-red">Node not found: {id}</div>;
  }

  const addressCount = Object.keys(targetAddresses).length;
  const annotationCount = linkedNodes.length + addressCount;

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {id && <Breadcrumbs ancestors={ancestors} onNavigate={onNavigate} />}
      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={ATLAS_GRID_STYLE}>
        <div className="overflow-y-auto" style={ATLAS_LEFT_PANE_STYLE}>
          <div className="max-w-2xl mx-auto px-1 py-2">
            {nodeList}
          </div>
        </div>
        {id && (
          <div className="flex flex-col hidden lg:flex" style={{ minHeight: 0 }}>
            <RightPanel
              id={id}
              linkedNodes={linkedNodes}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              annotationCount={annotationCount}
              onNavigate={onNavigate}
              tab={view}
              onTabChange={onViewChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
