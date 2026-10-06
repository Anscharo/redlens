import { useEffect, useState } from "react";

/**
 * The stages, in order, each shown for STAGE_MS. Copy is the reader's, kept as
 * given — it names what the meaning lane is actually doing (embed the query,
 * nearest-neighbour search in pgvector, fuse and attribute).
 */
const STAGES = ["Computing multidimensional vectors", "Finding best matches", "Comparing Results"];
const STAGE_MS = 2000;
/** 6s, the duration the fill is animated over. Mirrored by --semantic-fill-ms in index.css. */
export const SEMANTIC_PROGRESS_MS = STAGE_MS * STAGES.length;
/**
 * A settled lane answers in ~1ms from the worker's per-query cache, and a bar
 * that appears for one frame on every lane flip is worse than no bar. Nothing is
 * shown until the leg has been in flight this long.
 */
const APPEAR_AFTER_MS = 150;

/**
 * The meaning lane's progress bar, shown while its leg is in flight.
 *
 * It is TIME-BASED, not progress-based: nothing downstream reports how far along
 * an embed round-trip and a pgvector scan are, so the fill is a 6s animation and
 * the stages are a 2s timer. It holds at full rather than restarting if the
 * search outruns it — the component unmounts when the leg answers, so a held bar
 * means "still going", never "done".
 *
 * Which is why the bar is aria-hidden and the label is the live region: a
 * `role="progressbar"` with an aria-valuenow would be asserting a measurement
 * that does not exist. A screen reader hears the stages instead.
 */
export function SemanticProgress() {
  const [stage, setStage] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const appear = setTimeout(() => setShown(true), APPEAR_AFTER_MS);
    // Clamped, not wrapped: outrunning the last stage keeps saying the last
    // thing rather than looping back to "Computing…", which would read as a
    // restart the search never did.
    const tick = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), STAGE_MS);
    return () => {
      clearTimeout(appear);
      clearInterval(tick);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="semantic-progress-track" aria-hidden="true">
        <div className="semantic-progress-fill" />
      </div>
      <p role="status" className="mt-2 text-xs mono text-tan-3">
        {STAGES[stage]}
      </p>
    </div>
  );
}
