import { useState } from "react";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import type { TreeVisit } from "../../lib/historyIndex";
import { DocRow, LeaderRow } from "./VisitRow";

// A doc-number tree — "A.3.1", or five segments deep inside the Agent Scope.
// The header is a disclosure: opening it lists the documents of that tree you
// actually visited, most-viewed first, so the group's count is auditable.
function TreeGroup({ tree }: { tree: TreeVisit }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <LeaderRow count={tree.count}>
        <span className="flex items-baseline gap-2 min-w-0">
          <button
            type="button"
            className="text-sm text-left truncate hover:underline"
            style={{ color: "var(--tan-2)" }}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="mono text-[11px] mr-2" style={{ color: "var(--accent)" }}>
              {open ? "▾" : "▸"} {tree.key}
            </span>
            {tree.label}
          </button>
          {tree.id && (
            <Link
              to={atlasHref(tree.id)}
              className="mono text-[10px] shrink-0 hover:underline"
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
