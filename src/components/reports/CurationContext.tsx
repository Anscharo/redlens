// A document shown IN CONTEXT: the focal doc's full content, framed by the nearby
// entries (the docs before/after it in the same commit). Neighbors show title +
// doc_no and expand to full content on click — that surrounding structure is how
// near-identical siblings are told apart. When the two sides are compared, each
// neighbor is flagged + (added), Δ (changed) or − (removed) vs the other commit.
import { useState } from "react";
import { nodeLabel, type CurationNode } from "../../lib/historyCuration";

type Marker = { sym: string; color: string } | null;

// Compare a neighbor to the OTHER side's window (matched by title): exact content
// match → unchanged; same title, different body → changed; no match → added/removed.
function markerFor(node: CurationNode, compareTo: CurationNode[] | undefined, role: "newer" | "older"): Marker {
  if (!compareTo) return null;
  const sameTitle = compareTo.filter((c) => c.title === node.title);
  if (sameTitle.some((c) => c.content === node.content)) return null; // present + identical → unchanged
  if (!sameTitle.length) {
    return role === "newer"
      ? { sym: "+", color: "var(--diff-added-fg)" } // in newer, not older → added
      : { sym: "−", color: "var(--diff-removed-fg)" }; // in older, not newer → removed
  }
  return role === "newer" ? { sym: "Δ", color: "var(--accent)" } : null; // changed: flag once, on the newer side
}

function NeighborRow({ node, marker }: { node?: CurationNode; marker: Marker }) {
  const [open, setOpen] = useState(false);
  if (!node) return null;
  return (
    <div className="rounded px-2 py-1" style={{ border: "1px solid var(--border)", background: "var(--bg)" }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left flex gap-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
        <span className="shrink-0 w-3 text-center mono" style={{ color: marker ? marker.color : "transparent" }}>{marker?.sym ?? "·"}</span>
        <span className="mono shrink-0">{node.doc_no || "—"}</span>
        <span className="flex-1 truncate">{nodeLabel(node)}</span>
        <span className="shrink-0">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto text-[11px] whitespace-pre-wrap break-words mono" style={{ color: "var(--tan-2)" }}>
          {node.content || "(no prose)"}
        </pre>
      )}
    </div>
  );
}

export function ContextColumn({
  label, node, nodes, compareTo, role,
}: {
  label: string;
  node: CurationNode;
  nodes: Record<string, CurationNode>;
  compareTo?: CurationNode[];
  role: "newer" | "older";
}) {
  const prev = (node.prev || []).slice().reverse(); // nearest-first → render so nearest sits next to the focal doc
  const next = node.next || [];
  const row = (k: string) => {
    const n = nodes[k];
    return <NeighborRow key={k} node={n} marker={n ? markerFor(n, compareTo, role) : null} />;
  };
  return (
    <div>
      <p className="text-[11px] mb-1" style={{ color: "var(--tan-3)" }}>{label}</p>
      <div className="flex flex-col gap-1">
        {prev.map(row)}
        <div className="rounded p-2" style={{ border: "1px solid var(--accent)", background: "var(--surface)" }}>
          <div className="flex gap-2 text-[12px] mb-1" style={{ color: "var(--tan)" }}>
            <span className="mono shrink-0">{node.doc_no || "—"}</span>
            <span className="flex-1">{nodeLabel(node)}{node.type ? ` <${node.type}>` : ""}</span>
          </div>
          <pre className="max-h-[24rem] overflow-auto text-[12px] whitespace-pre-wrap break-words mono" style={{ color: "var(--tan-2)" }}>
            {node.content || "(no prose)"}
          </pre>
        </div>
        {next.map(row)}
      </div>
    </div>
  );
}
