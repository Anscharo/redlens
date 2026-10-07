import { useState } from "react";
import { BORDER } from "./primitiveTable";
import type { AffectedDoc } from "./actorHistoryMerge";
import { DocRow } from "./ActorHistoryDocRow";

// The per-commit table of an actor's affected docs, shown when a history row opens.

const TABLE_HEAD = (
  <>
    <colgroup>
      <col style={{ width: "12rem" }} />
      <col />
      <col style={{ width: "9rem" }} />
      <col style={{ width: "4rem" }} />
    </colgroup>
    <thead>
      <tr style={{ color: "var(--tan-3)", borderBottom: BORDER }}>
        <th className="text-left py-0.5 pr-3 font-normal">doc #</th>
        <th className="text-left py-0.5 pr-3 font-normal">doc title</th>
        <th className="text-left py-0.5 pr-3 font-normal">relevance</th>
        <th className="text-left py-0.5 font-normal">edit type</th>
      </tr>
    </thead>
  </>
);

function ConfigToggleRow({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <tr>
      <td colSpan={4} className="py-1">
        <button
          className="mono text-[10px] hover:underline focus-visible:underline"
          style={{ color: "var(--tan-3)" }}
          onClick={onToggle}
          aria-expanded={open}
        >
          {open ? "▾ hide" : `▸ +${count}`} instance config{" "}
          {count === 1 ? "change" : "changes"}
        </button>
      </td>
    </tr>
  );
}

export function DocTable({ docs }: { docs: AffectedDoc[] }) {
  // Nested instance-config edits are the noisy long tail — collapse them by
  // default so the agent-level docs (definition, instance, params) stay legible.
  const [showConfig, setShowConfig] = useState(false);
  const primary = docs.filter((d) => d.category !== "config");
  const config = docs.filter((d) => d.category === "config");
  const visible = showConfig ? [...primary, ...config] : primary;
  return (
    <table className="w-full mono text-[10px]" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
      {TABLE_HEAD}
      <tbody>
        {visible.map((d, i) => <DocRow key={d.docId} doc={d} rowIndex={i} />)}
        {config.length > 0 && (
          <ConfigToggleRow count={config.length} open={showConfig} onToggle={() => setShowConfig((s) => !s)} />
        )}
      </tbody>
    </table>
  );
}
