import { useEffect, useState } from "react";
import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import { CHANGE_COLOR, loadHistoryBatch, type HistoryEntry } from "../../lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import type { AtlasNode } from "../../types";
import { ROUTES } from "../../lib/routes";
import { useRadar } from "./RadarContext";
import { loadAtlas } from "../../lib/docs";
import { descendantIds } from "../../lib/instanceDescendants";
import { shortenTitle } from "../../lib/shortenTitle";
import { ROW_COLORS, BORDER } from "./primitiveTable";

type Category = "definition" | "instance" | "param" | "primitive" | "reward" | "config";
type ChangeKind = "lint" | "typo" | "semantic";

interface AffectedDoc {
  docId: string;
  docNo: string | null;
  title: string | null;
  category: Category;
  changeType: "added" | "modified" | "removed";
  /** Edit significance for modified entries — lets the UI mute trivial rows */
  changeKind?: ChangeKind;
}

interface MergedEntry {
  date: string;
  commitHash: string;
  pr?: number;
  prTitle?: string;
  prAuthor?: string;
  prUrl?: string;
  docs: AffectedDoc[];
}

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

const CHANGE_INDICATOR: Record<string, string> = {
  added: "+",
  modified: "~",
  removed: "−",
};

function buildDocCategoryMap(
  profile: ActorProfile,
  byParent: Map<string | null, AtlasNode[]>,
): Map<string, Category> {
  const map = new Map<string, Category>();
  // Invocation ICDs feed into history alongside instance ICDs — they're the
  // same kind of governance doc, just at a different lifecycle stage.
  const icds = [...profile.instances, ...profile.invocations];
  // Lowest priority first; later writes override.
  for (const inst of icds) {
    if (inst.primitiveDocId) map.set(inst.primitiveDocId, "primitive");
  }
  if (profile.rewardsAgent?.dr?.primitiveId) map.set(profile.rewardsAgent.dr.primitiveId, "reward");
  if (profile.rewardsAgent?.ib?.primitiveId) map.set(profile.rewardsAgent.ib.primitiveId, "reward");
  // Every doc nested under an instance/invocation root, so subtree edits (rate
  // limits, contract addresses, off-chain params) surface. Written before
  // param/instance/definition so those more-specific categories override a doc
  // that is both a descendant and, say, a param source.
  for (const inst of icds) {
    if (!inst.docId) continue;
    for (const id of descendantIds(inst.docId, byParent)) map.set(id, "config");
  }
  // Param-source docs next so the instance-root override wins if a param
  // points at its own config root (rare but possible).
  for (const inst of icds) {
    for (const p of inst.signalParams) {
      if (p.srcDocId) map.set(p.srcDocId, "param");
    }
  }
  for (const inst of icds) {
    if (inst.docId) map.set(inst.docId, "instance");
  }
  if (profile.definingDoc) map.set(profile.definingDoc.id, "definition");
  return map;
}

function mergeByCommit(
  perDoc: ReadonlyArray<readonly [string, HistoryEntry[]]>,
  docCategory: Map<string, Category>,
  docs: Record<string, AtlasNode>,
): MergedEntry[] {
  const byCommit = new Map<string, MergedEntry>();
  for (const [docId, entries] of perDoc) {
    const category = docCategory.get(docId);
    if (!category) continue;
    for (const entry of entries) {
      // "moved" events are renumbering noise (atomization, doc-no reshuffles).
      if (entry.changeType === "moved") continue;
      const affected: AffectedDoc = {
        docId,
        docNo: docs[docId]?.doc_no ?? null,
        title: docs[docId]?.title ?? null,
        category,
        changeType: entry.changeType as AffectedDoc["changeType"],
        changeKind: entry.changeKind,
      };
      const existing = byCommit.get(entry.commitHash);
      if (existing) {
        if (!existing.docs.some((d) => d.docId === docId)) existing.docs.push(affected);
      } else {
        byCommit.set(entry.commitHash, {
          date: entry.date,
          commitHash: entry.commitHash,
          pr: entry.pr,
          prTitle: entry.prTitle,
          prAuthor: entry.prAuthor,
          prUrl: entry.prUrl,
          docs: [affected],
        });
      }
    }
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}

interface Props {
  profile: ActorProfile;
}

export function ActorHistory({ profile }: Props) {
  const { docs } = useRadar();
  const [entries, setEntries] = useState<MergedEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries(null);
    // byParent is the doc_no-based tree (loadAtlas → atlas.worker); needed to
    // expand instance roots into their nested config docs. Cached promise.
    loadAtlas().then(({ byParent }) => {
      if (cancelled) return;
      const docCategory = buildDocCategoryMap(profile, byParent);
      // One batched round-trip instead of one request per doc — an actor like
      // Spark spans ~1.2k docs once instance subtrees are included.
      loadHistoryBatch([...docCategory.keys()]).then((byDoc) => {
        if (cancelled) return;
        setEntries(mergeByCommit([...byDoc], docCategory, docs));
        setLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, [profile, docs]);

  if (loading) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>loading history…</p>;
  }
  if (!entries || entries.length === 0) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>no history recorded</p>;
  }
  return (
    <div>
      {entries.map((e) => (
        <Entry key={e.commitHash} entry={e} />
      ))}
    </div>
  );
}

function docHref(docId: string): string {
  return `${ROUTES.ATLAS}?id=${docId}&view=history`;
}

function Entry({ entry }: { entry: MergedEntry }) {
  const [open, setOpen] = useState(false);
  const prSuffix = entry.pr ? ` — #${entry.pr}` : "";
  const changeTypes = [...new Set(entry.docs.map((d) => d.changeType))];
  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <button
        className="w-full text-left flex items-start gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="mono text-[10px] mt-0.5 shrink-0" style={{ color: "var(--tan-3)" }}>
          {open ? "▾" : "▸"}
        </span>
        <div>
          <div className="mono text-xs font-semibold" style={{ color: "var(--tan)" }}>
            {entry.date}{prSuffix}
          </div>
          {entry.prTitle && (
            <div className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--tan-3)" }}>
              {entry.prTitle}
            </div>
          )}
        </div>
      </button>
      {open && (
        <div className="mt-2 ml-4 min-w-0 overflow-hidden">
          <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-2">
            {changeTypes.map((ct) => (
              <span key={ct} style={{ color: CHANGE_COLOR[ct] }}>
                {CHANGE_INDICATOR[ct]}
              </span>
            ))}
            {entry.pr && (
              <a href={entry.prUrl} target="_blank" rel="noopener noreferrer"
                 className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
                #{entry.pr}
              </a>
            )}
            <a href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
               target="_blank" rel="noopener noreferrer"
               className="hover:underline focus-visible:underline" style={{ color: "var(--tan-3)" }}>
              {entry.commitHash.slice(0, 7)}
            </a>
            {entry.prAuthor && <span style={{ color: "var(--tan-3)" }}>{entry.prAuthor}</span>}
          </div>
          <DocTable docs={entry.docs} />
        </div>
      )}
    </div>
  );
}

function DocTable({ docs }: { docs: AffectedDoc[] }) {
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
