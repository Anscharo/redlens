import { useMemo } from "react";
import type { DiffLine, WordSegment } from "@/lib/history";
import { wordDiff } from "@/lib/diffCore";
import { refineProseDiff } from "../../lib/diffProse";
import { usePreviewDiff } from "../../lib/previewDiff";
import { DiffView } from "./DiffView";
import { IntralineDiff } from "./IntralineDiff";

/** The title pair as one modified line, refined the way DiffView refines a
 *  body line. When the refinement swaps the whole title, the old one is shown
 *  struck through and the new one after it, on the same line. */
function titleSegments(prev: string, next: string): WordSegment[] {
  const [line, ...rest] = refineProseDiff([["~", wordDiff(prev, next)]]);
  const segments = line?.[0] === "~" && rest.length === 0 ? (line[1] as WordSegment[]) : [];
  return segments.some(([op]) => op === "=") ? segments : [["-", prev], ["=", " "], ["+", next]];
}

/** A document's title change: removed words struck through, added words
 *  highlighted, with the same word and sentence diff a body line gets. */
export function TitleDiff({ prev, next }: { prev: string; next: string }) {
  const segments = useMemo(() => titleSegments(prev, next), [prev, next]);
  return (
    <p className="mt-2 text-[13px] leading-snug">
      <span className="sr-only">Title changed: </span>
      <IntralineDiff segments={segments} className="whitespace-pre-wrap break-words" />
    </p>
  );
}

/** The preview entry's diff: the title change, when there is one, right above
 *  the body diff box. An identity swap's paragraph already names both titles,
 *  so a swapped doc shows only the box. */
export function PreviewDocDiff({ nodeId, patch }: { nodeId: string; patch: DiffLine[] | null | undefined }) {
  const diff = usePreviewDiff();
  const retitle = diff.retitled[nodeId];
  return (
    <>
      {retitle && !diff.identitySwap[nodeId] && <TitleDiff prev={retitle[0]} next={retitle[1]} />}
      {patch && patch.length > 0 && <DiffView lines={patch} />}
    </>
  );
}
