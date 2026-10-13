// What to say about a rate limit no Atlas document is connected to, by how its
// latest value reached the chain (origin.ts): a spell (or a relay of one) means
// the Atlas edit should already have been made, since a Prime Spell's provenance
// is the ratified Atlas or Artifact edit (6e254deb-fe5d-4345-8916-bce01463fee5, A.1.10.2.3.2.2.3.3.5), so either the
// portal failed to connect the limit or the spell ran before the Atlas was
// updated; a Configurator (cBEAM) change needs no spell, so the Atlas
// lagging is expected and only a lag past two months is worth flagging.
// A switched-off limit and any other origin are not flagged. Pure.
import type { OriginKind } from "./pauHistory.ts";

/** How long a cBEAM-set limit may go without an Atlas document before it is flagged. */
export const CBEAM_LAG_DAYS = 60;

export interface AtlasFlag {
  kind: "spell" | "cbeam";
  text: string;
}

const DAY = 86_400_000;

/** The flag for a limit with no Atlas document, or null when it earns none. `origin` is null while the history loads or holds no row. */
export function unmatchedFlag(origin: OriginKind | null | undefined, setTime: string, off: boolean, now: number): AtlasFlag | null {
  if (off || !origin) return null;
  const date = setTime.slice(0, 10);
  if (origin === "spell" || origin === "relayed") {
    return { kind: "spell", text: `No Atlas document found for this limit, set by a spell on ${date}. Either Redline Portal failed to connect it to a document, or the spell was executed before the Atlas was updated.` };
  }
  if (origin === "operator" && now - Date.parse(setTime) > CBEAM_LAG_DAYS * DAY) {
    return { kind: "cbeam", text: `No Atlas document found for this limit, set through the Configurator (a cBEAM) on ${date}. The Atlas is probably behind, which is not unexpected for a cBEAM change, but it has been more than 2 months.` };
  }
  return null;
}
