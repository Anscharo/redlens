import { useEffect, useState } from "react";
import { loadHistoryBatch } from "@/lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import { useRadar } from "./RadarContext";
import { loadAtlas } from "../../lib/docs";
import { mergeByCommit, type MergedEntry } from "./actorHistoryMerge";
import { buildDocCategoryMap } from "./actorHistoryCategories";
import { ActorHistoryEntry } from "./ActorHistoryEntry";

interface Props {
  profile: ActorProfile;
}

export function ActorHistory({ profile }: Props) {
  const { docs } = useRadar();
  const [entries, setEntries] = useState<MergedEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => loadActorEntries(profile, docs, setEntries, setLoading), [profile, docs]);

  if (loading) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>loading history…</p>;
  }
  if (!entries || entries.length === 0) {
    return <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>no history recorded</p>;
  }
  return (
    <div>
      {entries.map((e) => (
        <ActorHistoryEntry key={e.commitHash} entry={e} agentSlug={profile.entity.slug} agentName={profile.entity.name} />
      ))}
    </div>
  );
}

function loadActorEntries(
  profile: ActorProfile,
  docs: Parameters<typeof mergeByCommit>[2],
  setEntries: (entries: MergedEntry[] | null) => void,
  setLoading: (loading: boolean) => void,
) {
  let cancelled = false;
  setLoading(true);
  setEntries(null);
  loadAtlas()
    .then(({ byParent }) => {
      if (cancelled) return;
      const docCategory = buildDocCategoryMap(profile, byParent);
      return loadHistoryBatch([...docCategory.keys()]).then((byDoc) => {
        if (cancelled) return;
        setEntries(mergeByCommit([...byDoc], docCategory, docs));
        setLoading(false);
      });
    })
    .catch(() => {
      if (cancelled) return;
      setEntries([]);
      setLoading(false);
    });
  return () => {
    cancelled = true;
  };
}
