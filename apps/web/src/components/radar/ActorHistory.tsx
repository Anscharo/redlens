import { useEffect, useState } from "react";
import { ATLAS_REPO, CHANGE_COLOR, isGitSha, loadHistoryBatch, prHref, severedRange } from "@/lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import { useRadar } from "./RadarContext";
import { loadAtlas } from "../../lib/docs";
import { track } from "../../lib/analytics";
import { buildDocCategoryMap, mergeByCommit, type MergedEntry } from "./actorHistoryMerge";
import { CHANGE_INDICATOR, DocTable } from "./ActorHistoryDocTable";

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
      return loadHistoryBatch([...docCategory.keys()]).then((byDoc) => {
        if (cancelled) return;
        setEntries(mergeByCommit([...byDoc], docCategory, docs));
        setLoading(false);
      });
    }).catch(() => {
      // loadHistoryBatch swallows its own errors, but loadAtlas can reject
      // (worker / docs.json failure). Without this the panel would hang on
      // "loading history…" forever — degrade to the empty state instead.
      if (cancelled) return;
      setEntries([]);
      setLoading(false);
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
        <Entry
          key={e.commitHash}
          entry={e}
          agentSlug={profile.entity.slug}
          agentName={profile.entity.name}
        />
      ))}
    </div>
  );
}

function Entry({
  entry,
  agentSlug,
  agentName,
}: {
  entry: MergedEntry;
  agentSlug: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const prSuffix = entry.pr ? ` — #${entry.pr}` : "";
  const changeTypes = [...new Set(entry.docs.map((d) => d.changeType))];
  // Severed-era rows (docs/plans/pre-git-history.md) have no commit date — the
  // server sends "". Fall back to the reconstructed month-range label (mirrors
  // the reader's severedRange treatment in EntryRow) so the row never renders
  // a blank clickable heading (H3); a bare commitHash is the last resort.
  const heading = entry.date || severedRange(entry.commitHash) || entry.commitHash;
  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <button
        className="w-full text-left flex items-start gap-1.5"
        onClick={() => {
          track("radar_history_toggle", {
            agent_slug: agentSlug,
            agent_name: agentName,
            commit: entry.commitHash,
            pr: entry.pr ?? null,
            date: entry.date,
            open: !open,
          });
          setOpen((o) => !o);
        }}
        aria-expanded={open}
      >
        <span className="mono text-[10px] mt-0.5 shrink-0" style={{ color: "var(--tan-3)" }}>
          {open ? "▾" : "▸"}
        </span>
        <div>
          <div className="mono text-xs font-semibold" style={{ color: "var(--tan)" }}>
            {heading}{prSuffix}
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
              <a href={prHref(entry)} target="_blank" rel="noopener noreferrer"
                 className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
                #{entry.pr}
              </a>
            )}
            {isGitSha(entry.commitHash) ? (
              <a href={`${ATLAS_REPO}/commit/${entry.commitHash}`}
                 target="_blank" rel="noopener noreferrer"
                 className="hover:underline focus-visible:underline" style={{ color: "var(--tan-3)" }}>
                {entry.commitHash.slice(0, 7)}
              </a>
            ) : (
              // Reconstructed pre-git origin (docs/plans/pre-git-history.md): a synthetic
              // tag, not a commit — no dead github.com/.../commit/ link, just the era.
              <span style={{ color: "var(--tan-3)" }}>{entry.era ?? entry.commitHash}</span>
            )}
            {entry.prAuthor && <span style={{ color: "var(--tan-3)" }}>{entry.prAuthor}</span>}
          </div>
          <DocTable docs={entry.docs} />
        </div>
      )}
    </div>
  );
}
