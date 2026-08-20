import { useState } from "react";
import { Link } from "../Link";
import { atlasHref } from "@/lib/routes";
import type { TreeVisit } from "@/lib/visitTrees";
import { DocRow, LeaderRow } from "./VisitRow";

// A doc-number tree — "A.3.1.X…", or five segments deep inside the Agent Scope.
// The header reads <pattern> <owner> ⇒ <top-of-tree document>, where the owner
// is the Scope (or the agent, for agent artifacts). Opening it lists the
// documents of that tree you actually visited, most-viewed first, so the
// group's count is auditable.
function TreeGroup({ tree }: { tree: TreeVisit }) {
  const [open, setOpen] = useState(false);
  // Inside the Agent Scope the tree root IS the agent, so owner and label are
  // the same string — print it once rather than "Spark ⇒ Spark".
  const showLabel = tree.owner !== tree.label;
  return (
    <div>
      <LeaderRow count={tree.count}>
        <span className="flex items-baseline gap-2 min-w-0">
          <button
            type="button"
            className="text-[15px] text-left truncate hover:underline"
            style={{ color: "var(--tan-2)" }}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="mono text-xs mr-2" style={{ color: "var(--accent)" }}>
              {open ? "▾" : "▸"} {tree.pattern}
            </span>
            {tree.owner && <span style={{ color: "var(--tan-3)" }}>{tree.owner}</span>}
            {tree.owner && showLabel && <span className="mx-1.5" style={{ color: "var(--gray)" }}>⇒</span>}
            {showLabel && tree.label}
          </button>
          {tree.id && (
            <Link
              to={atlasHref(tree.id)}
              className="mono text-[11px] shrink-0 hover:underline"
              style={{ color: "var(--tan-3)" }}
              title={`Open ${tree.key} in the reader`}
            >
              open
            </Link>
          )}
        </span>
      </LeaderRow>
      {open && (
        <div className="pb-1">
          {tree.docs.map((d) => (
            <DocRow key={d.id} path={d.path} docNo={d.docNo} label={d.label} count={d.count} indent />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeRows({ trees }: { trees: TreeVisit[] }) {
  return (
    <>
      {trees.map((t) => (
        <TreeGroup key={t.key} tree={t} />
      ))}
    </>
  );
}
