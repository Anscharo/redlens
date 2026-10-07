import { useState } from "react";
import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import { CHANGE_COLOR } from "@/lib/history";
import { ROUTES } from "@/lib/routes";
import { shortenTitle } from "@/lib/shortenTitle";
import { ROW_COLORS, BORDER } from "./primitiveTable";
import type { AffectedDoc, Category, ChangeKind } from "./actorHistoryMerge";

// The per-commit table of an actor's affected docs, shown when a history row opens.

const CATEGORY_LABEL: Record<Category, string> = {
  definition: "agent definition",
  instance: "agent instance",
  param: "instance parameter",
  primitive: "primitive agent owns",
  reward: "rewards primitive",
  config: "instance config",
};

const CATEGORY_TOOLTIP: Record<Category, string> = {
  definition: "The document that defines this agent's role, scope, and authorizations.",
  instance: "An active instance or invocation of this agent in the governance system.",
  param: "A document that is the source of a parameter for one of this agent's instances.",
  primitive: "A primitive that this agent is authorized to own and invoke.",
  reward: "The rewards primitive linked to this agent's compensation.",
  config: "A configuration document nested inside one of this agent's instances (e.g. rate limits, contract addresses, off-chain parameters).",
};

export const CHANGE_INDICATOR: Record<string, string> = {
  added: "+",
  modified: "~",
  removed: "−",
  moved: "→",
};

function docHref(docId: string): string {
  return `${ROUTES.ATLAS}?id=${docId}&view=history`;
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
      <tbody>
        {visible.map((d, i) => <DocRow key={d.docId} doc={d} rowIndex={i} />)}
        {config.length > 0 && (
          <tr>
            <td colSpan={4} className="py-1">
              <button
                className="mono text-[10px] hover:underline focus-visible:underline"
                style={{ color: "var(--tan-3)" }}
                onClick={() => setShowConfig((s) => !s)}
                aria-expanded={showConfig}
              >
                {showConfig ? "▾ hide" : `▸ +${config.length}`} instance config{" "}
                {config.length === 1 ? "change" : "changes"}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function editTooltip(changeType: AffectedDoc["changeType"], changeKind?: ChangeKind): string {
  const base = `${changeType} doc`;
  if (!changeKind || changeKind === "semantic") return base;
  const detail = changeKind === "lint" ? "whitespace / formatting only" : "small letter-level edit";
  return `${base}  ·  ${changeKind} (${detail})`;
}

function DocRow({ doc: d, rowIndex }: { doc: AffectedDoc; rowIndex: number }) {
  return (
    <tr style={{ background: ROW_COLORS[rowIndex % 2] }}>
      <td className="py-0.5 pr-3" style={{ verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {d.docNo ? (
          <Link to={docHref(d.docId)} className="hover:underline focus-visible:underline"
                style={{ color: "var(--accent)" }}>
            {d.docNo}
          </Link>
        ) : (
          <span style={{ color: "var(--tan-3)" }}>—</span>
        )}
      </td>
      <td className="py-0.5 pr-3" style={{ color: "var(--tan-2)", verticalAlign: "middle", overflow: "hidden" }}>
        <span className="block truncate">
          {d.title ? shortenTitle(d.title, 48) : ""}
        </span>
        {/* Renumber detail for a genuine "moved" doc — omitted for a
            self-move (movedFrom/movedTo absent, see AffectedDoc) so no
            "A.1 → A.1" nonsense ever renders. */}
        {d.movedFrom && d.movedTo && (
          <span className="block truncate mono text-[9px]" style={{ color: "var(--tan-3)" }}>
            {d.movedFrom} → {d.movedTo}
          </span>
        )}
      </td>
      <td className="py-0.5 pr-3" style={{ verticalAlign: "middle", overflow: "hidden" }}>
        <Tooltip content={CATEGORY_TOOLTIP[d.category]}>
          <span className="px-1 rounded cursor-help"
                style={{ background: "var(--hover)", color: "var(--tan-2)" }}>
            {CATEGORY_LABEL[d.category]}
          </span>
        </Tooltip>
      </td>
      <td className="py-0.5" style={{ verticalAlign: "middle", overflow: "hidden" }}>
        <Tooltip content={editTooltip(d.changeType, d.changeKind)}>
          <span className="flex items-center gap-1.5 cursor-help">
            <span style={{ color: CHANGE_COLOR[d.changeType] }}>
              {CHANGE_INDICATOR[d.changeType]}
            </span>
            {d.changeKind && d.changeKind !== "semantic" && (
              <span style={{ color: "var(--tan-3)" }}>{d.changeKind}</span>
            )}
          </span>
        </Tooltip>
      </td>
    </tr>
  );
}
