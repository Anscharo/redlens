// Shared target-rendering for the II.7 Topics data — used by both
// CrossViewIndexList.tsx (in-doc list) and CrossViewTopicIndex.tsx (right
// panel) so a topic's targets render identically (and link identically) in
// either surface. See src/lib/crossviewIndex.ts for the parse + grouping logic
// this renders.
import { groupTargetsForDisplay, type CrossViewIndexTarget } from "@/lib/crossviewIndex";

export function TargetLinks({ targets }: { targets: CrossViewIndexTarget[] }) {
  const grouped = groupTargetsForDisplay(targets);
  if (grouped.mode === "compact") {
    return (
      <>
        {grouped.family}{" "}
        {grouped.nums.map((n, i) => (
          <span key={n.num}>
            {i > 0 && " · "}
            {n.slug ? <a href={`#${n.slug}`}>{n.num}</a> : <span className="text-tan-3">{n.num}</span>}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {grouped.targets.map((t, i) => (
        <span key={t.label}>
          {i > 0 && " / "}
          {t.slug ? <a href={`#${t.slug}`}>{t.label}</a> : <span className="text-tan-3">{t.label}</span>}
        </span>
      ))}
    </>
  );
}
