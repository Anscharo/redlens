import { memo, useEffect, useRef } from "react";
import { NodeContent } from "./NodeContent";
import type { AtlasNode } from "../types";

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-medium",
};

const DEPTH_INDENT: Record<number, string> = {
  1: "pl-0",
  2: "pl-0",
  3: "pl-4",
  4: "pl-8",
  5: "pl-12",
  6: "pl-16",
};

export const ScopeNode = memo(function ScopeNode({ node, isTarget, onNavigate }: { node: AtlasNode; isTarget: boolean; onNavigate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTarget) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [isTarget]);

  return (
    <div
      ref={ref}
      id={node.id}
      className={["scope-node py-4 border-b cursor-pointer", DEPTH_INDENT[node.depth] ?? "pl-16", isTarget ? "is-target" : "is-muted"].join(" ")}
      onClick={() => onNavigate(node.id)}
      style={{
        borderColor: "var(--border)",
        marginLeft: "-1rem",
        paddingLeft: `calc(${["0","0","1rem","2rem","3rem","4rem"][node.depth - 1] ?? "4rem"} + 1rem)`,
        boxShadow: isTarget ? "inset 3px 0 0 var(--red)" : undefined,
        scrollMarginTop: "64px",
      }}
    >
      <p
        className={`mb-1 ${DEPTH_HEADING[node.depth] ?? "text-sm font-medium"}`}
        style={{ color: "var(--tan)" }}
      >
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{
            background: "var(--surface)",
            color: isTarget ? "var(--red)" : "var(--tan-2)",
            border: "1px solid var(--border)",
          }}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{node.doc_no}</span>
        <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{node.id}</span>
      </div>
      {node.content && (
        <div>
          <NodeContent content={node.content} addresses={node.addresses} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
