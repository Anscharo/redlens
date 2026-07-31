import { useMemo, useEffect, useCallback, memo, useState } from "react";
import { AtlasLink } from "../AtlasLink";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { parseMeta } from "../../lib/meta";
import type { EntityNodeData, EntityEdgeData, EntityRelation } from "../../lib/entityGraph";
import { edgeLabel, ENTITY_TYPE_LABEL, SUBTYPE_LABEL } from "../../lib/entityGraph";
import { getEdges, type EdgeResult } from "../../lib/graph";
import { atlasHref } from "../../lib/routes";
import { track } from "../../lib/analytics";
import type { GraphEntity } from "../../types";

const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

const EDGE_COLOR = "var(--edge)";
const EDGE_HIGHLIGHT = "var(--accent)";

type CardData = {
  label: string;
  color: string;
  entityType: string;
  subtype: string | null;
  degree: number;
  entity: GraphEntity;
  onSelect: (id: string) => void;
};

type CardNode = Node<CardData, "entity">;

const EntityCard = memo(function EntityCard({ data, selected }: NodeProps<CardNode>) {
  const { label, color, entityType, subtype, degree, entity, onSelect } = data;
  const typeLabel = ENTITY_TYPE_LABEL[entityType] ?? entityType;
  const subLabel = subtype ? (SUBTYPE_LABEL[subtype] ?? subtype) : null;

  return (
    <div
      className={`entity-card ${selected ? "is-open" : "is-closed"}`}
      style={{
        background: "var(--surface)",
        border: `1px solid ${selected ? color : "var(--border)"}`,
        borderRadius: 10,
        padding: selected ? "12px 14px" : "6px 10px",
        minWidth: 160,
        maxWidth: selected ? 550 : 250,
        boxShadow: selected ? "0 8px 24px var(--shadow-strong)" : "0 2px 6px var(--shadow)",
        transition: "width 150ms ease, padding 150ms ease",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
      <div className="flex items-center gap-2">
        <span className="inline-block rounded-full shrink-0" style={{ background: color, width: selected ? 10 : 8, height: selected ? 10 : 8 }} />
        <span className="font-semibold text-sm truncate" style={{ color: "var(--tan)" }}>{label}</span>
      </div>
      <div className="mono text-[10px] mt-0.5" style={{ color: "var(--tan-3)" }}>
        {typeLabel}{subLabel ? ` · ${subLabel}` : ""}
      </div>
      {selected && <CardBody entity={entity} onSelect={onSelect} />}
      {!selected && degree > 0 && (
        <div className="mono text-[9px] mt-1" style={{ color: "var(--tan-3)" }}>
          {degree} connection{degree !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
});

function resolveLabel(id: string, type: string, workerLabel?: string): string {
  if (workerLabel) return workerLabel;
  if (type === "address") return id.startsWith("addr:") ? id.slice(5, 17) + "…" : id.slice(0, 10);
  return id.slice(0, 8);
}

function edgeResultToRelations(result: EdgeResult): EntityRelation[] {
  return [
    ...result.outbound.map((e) => ({
      edge: e, direction: "outbound" as const,
      otherId: e.t, otherType: e.tt as EntityRelation["otherType"],
      otherLabel: resolveLabel(e.t, e.tt, e.to_label),
    })),
    ...result.inbound.map((e) => ({
      edge: e, direction: "inbound" as const,
      otherId: e.f, otherType: e.ft as EntityRelation["otherType"],
      otherLabel: resolveLabel(e.f, e.ft, e.from_label),
    })),
  ];
}

function CardBody({ entity, onSelect }: {
  entity: GraphEntity;
  onSelect: (id: string) => void;
}) {
  const [edgeResult, setEdgeResult] = useState<EdgeResult | null>(null);
  useEffect(() => {
    setEdgeResult(null);
    let cancelled = false;
    getEdges(entity.id)
      .then((r) => {
        if (!cancelled) setEdgeResult(r);
      })
      .catch((err) => console.warn("graph edges request failed", err));
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  const grouped = useMemo(() => {
    if (!edgeResult) return [];
    const byType = new Map<string, { edgeType: string; direction: "outbound" | "inbound"; rels: EntityRelation[] }>();
    for (const r of edgeResultToRelations(edgeResult)) {
      const k = `${r.edge.e}|${r.direction}`;
      let bucket = byType.get(k);
      if (!bucket) { bucket = { edgeType: r.edge.e, direction: r.direction, rels: [] }; byType.set(k, bucket); }
      bucket.rels.push(r);
    }
    return [...byType.values()].sort((a, b) => b.rels.length - a.rels.length);
  }, [edgeResult]);

  const params = useMemo(() => {
    const m = parseMeta<{ params?: Record<string, [string, string, string]> }>(entity.m);
    return m?.params && Object.keys(m.params).length > 0 ? m.params : null;
  }, [entity.m]);

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
      {entity.did && (
        <AtlasLink to={atlasHref(entity.did)} onClick={stopPropagation}
          className="mono text-[11px] hover:underline mb-3 inline-block" style={{ color: "var(--accent)" }}>
          <span className="enlargen">→</span> defining document
        </AtlasLink>
      )}
      {params && (
        <div className="mb-3">
          <p className="mono text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--tan-3)" }}>
            parameters · {Object.keys(params).length}
          </p>
          <div className="space-y-1">
            {Object.entries(params).map(([key, [value, srcId, srcDocNo]]) => (
              <div key={key} className="text-[10px] leading-tight">
                <AtlasLink to={atlasHref(srcId)} onClick={stopPropagation}
                  className="mono hover:underline" style={{ color: "var(--tan-3)" }} title={srcDocNo}>{key}</AtlasLink>
                <span className="mx-1" style={{ color: "var(--tan-3)" }}>:</span>
                <span style={{ color: "var(--tan-2)" }}>{value.length > 90 ? value.slice(0, 90) + "…" : value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!edgeResult ? (
        <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>…</p>
      ) : grouped.length === 0 ? (
        <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>No relations.</p>
      ) : grouped.map(({ edgeType, direction, rels }) => (
        <div key={`${edgeType}|${direction}`} className="mb-2.5 last:mb-0">
          <p className="mono text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--tan-3)" }}>
            {edgeLabel(edgeType, direction)} · {rels.length}
          </p>
          <div className="flex flex-wrap gap-1">
            {rels.map((r, i) => <RelationChip key={i} rel={r} onSelect={onSelect} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelationChip({ rel, onSelect }: {
  rel: EntityRelation;
  onSelect: (id: string) => void;
}) {
  const { otherType, otherId, otherLabel, direction } = rel;
  const sources = rel.edge.s ?? [];
  const title = sources.length ? `cited in ${sources.join(", ")}` : "structural edge";
  const className = "mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1";
  const baseStyle: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--tan-2)",
    border: "1px solid var(--border)",
  };
  const arrow = direction === "outbound" ? "→" : "←";

  if (otherType === "doc") {
    return (
      <AtlasLink
        to={atlasHref(otherId)}
        onClick={stopPropagation}
        className={`${className} hover:bg-hover`}
        style={baseStyle}
        title={title}
      >
        <span className="enlargen" style={{ color: "var(--tan-3)" }}>{arrow}</span>
        <span>{otherLabel}</span>
      </AtlasLink>
    );
  }
  if (otherType === "entity") {
    return (
      <button
        className={`${className} hover:bg-hover`}
        style={{ ...baseStyle, cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); onSelect(otherId); }}
        title={title}
      >
        <span className="enlargen" style={{ color: "var(--tan-3)" }}>{arrow}</span>
        <span>{otherLabel}</span>
      </button>
    );
  }
  return (
    <span className={className} style={{ ...baseStyle, cursor: "default" }} title={title}>
      <span className="enlargen" style={{ color: "var(--tan-3)" }}>{arrow}</span>
      <span>{otherLabel}</span>
    </span>
  );
}

const nodeTypes = { entity: EntityCard };

function EntityFlowInner({
  allNodes,
  allEdges,
  visibleIds,
  selectedId,
  onSelect,
}: {
  allNodes: EntityNodeData[];
  allEdges: EntityEdgeData[];
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Force layout runs ONCE on the full node/edge set.
  const positions = useMemo(() => {
    const g = new MultiDirectedGraph();
    const N = allNodes.length || 1;
    allNodes.forEach((n, i) => {
      const angle = (i / N) * 2 * Math.PI;
      g.addNode(n.id, { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200, size: 90 });
    });
    for (const e of allEdges) {
      if (g.hasNode(e.src) && g.hasNode(e.tgt)) g.addDirectedEdgeWithKey(e.key, e.src, e.tgt);
    }
    const settings = forceAtlas2.inferSettings(g);
    forceAtlas2.assign(g, { iterations: 500, settings: { ...settings, gravity: 1.5, scalingRatio: 5, slowDown: 3 } });
    noverlap.assign(g, { maxIterations: 300, settings: { margin: 12, ratio: 1.0, speed: 4 } });
    const pts: { x: number; y: number }[] = [];
    g.forEachNode((_, a) => pts.push({ x: a.x as number, y: a.y as number }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dists = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
    const cap = dists[Math.floor(dists.length * 0.85)] * 1.2;
    g.updateEachNodeAttributes((_, attrs) => {
      const dx = (attrs.x as number) - cx, dy = (attrs.y as number) - cy;
      const d = Math.hypot(dx, dy);
      if (d > cap) { const s = cap / d; return { ...attrs, x: cx + dx * s, y: cy + dy * s }; }
      return attrs;
    });
    const pos = new Map<string, { x: number; y: number }>();
    g.forEachNode((id, a) => pos.set(id, { x: a.x as number, y: a.y as number }));
    return pos;
  }, [allNodes, allEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheap O(n) — just sets hidden/selected flags on pre-positioned nodes.
  const rfNodes = useMemo<CardNode[]>(() =>
    allNodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id, type: "entity" as const, position: pos,
        hidden: !visibleIds.has(n.id),
        selected: n.id === selectedId,
        data: { label: n.label, color: n.color, entityType: n.entity.et, subtype: n.entity.st, degree: n.degree, entity: n.entity, onSelect },
      };
    }), [positions, allNodes, visibleIds, selectedId, onSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheap O(edges) — hides edges where either endpoint is hidden.
  const rfEdges = useMemo<Edge[]>(() =>
    allEdges.map((e) => {
      const active = !!selectedId && (e.src === selectedId || e.tgt === selectedId);
      return {
        id: e.key, source: e.src, target: e.tgt,
        hidden: !(visibleIds.has(e.src) && visibleIds.has(e.tgt)),
        label: edgeLabel(e.type, "outbound"),
        style: { stroke: active ? EDGE_HIGHLIGHT : EDGE_COLOR, strokeWidth: active ? 2 : 1.2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: active ? EDGE_HIGHLIGHT : EDGE_COLOR, width: 16, height: 16 },
        labelStyle: { fill: "var(--edge-label-fg)", fontSize: 10, fontFamily: "'Source Code Pro', monospace" },
        labelBgStyle: { fill: "var(--bg)", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        zIndex: active ? 1 : 0,
      };
    }), [allEdges, visibleIds, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  const handleNodeClick = useCallback<NodeMouseHandler<CardNode>>(
    (_, node) => {
      track("constellation_select", { entity_id: node.id });
      onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick} nodeTypes={nodeTypes} fitView minZoom={0.2} maxZoom={2}
      nodesConnectable={false} colorMode="dark" proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="var(--graph-dots)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export const EntityFlow = memo(EntityFlowInner) as typeof EntityFlowInner;
