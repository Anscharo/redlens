import { ATLAS_REPO, CHANGE_COLOR, isGitSha, prHref } from "@/lib/history";
import { CHANGE_MARK } from "@/lib/changeTypes";
import { DocTable } from "./ActorHistoryDocTable";
import type { MergedEntry } from "./actorHistoryMerge";

export function HistoryDetail({ entry }: { entry: MergedEntry }) {
  const changeTypes = [...new Set(entry.docs.map((d) => d.changeType))];
  return (
    <div className="mt-2 ml-4 min-w-0 overflow-hidden">
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-2">
        {changeTypes.map((ct) => (
          <span key={ct} title={ct} style={{ color: CHANGE_COLOR[ct] }}>{CHANGE_MARK[ct]}</span>
        ))}
        {entry.pr && (
          <a href={prHref(entry)} target="_blank" rel="noopener noreferrer" className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
            #{entry.pr}
          </a>
        )}
        <CommitRef hash={entry.commitHash} era={entry.era} />
        {entry.prAuthor && <span style={{ color: "var(--tan-3)" }}>{entry.prAuthor}</span>}
      </div>
      <DocTable docs={entry.docs} />
    </div>
  );
}

function CommitRef({ hash, era }: { hash: string; era?: string }) {
  if (!isGitSha(hash)) return <span style={{ color: "var(--tan-3)" }}>{era ?? hash}</span>;
  return (
    <a
      href={`${ATLAS_REPO}/commit/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline focus-visible:underline"
      style={{ color: "var(--tan-3)" }}
    >
      {hash.slice(0, 7)}
    </a>
  );
}
