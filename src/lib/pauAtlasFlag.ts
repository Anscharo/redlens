// What to say about a rate limit no Atlas document is connected to, by how its
// latest value reached the chain (origin.ts). Nothing on-chain waits for the
// Atlas, so a missing document has two possible causes: Redline Portal did not
// connect the limit to a document that states it, or no document states it.
// A spell (or a relay of one) calls for a flag at once, because a Prime Spell's
// changes are ratified into the Atlas before the spell goes to an Executive Vote
// (6e254deb-fe5d-4345-8916-bce01463fee5, A.1.10.2.3.2.2.3.3.5). A Configurator
// (cBEAM) change needs no vote and does not wait for one
// (ae05e069-0626-45f5-82d2-dbf39a5b2598, A.1.10.3.2.10.5), so it is flagged only
// once the lag passes two months. A switched-off limit and any other origin are
// not flagged. Pure.
import type { OriginKind } from "./pauHistory.ts";

/** How long a cBEAM-set limit may go without an Atlas document before it is flagged. */
export const CBEAM_LAG_DAYS = 60;

export interface AtlasFlag {
  kind: "spell" | "cbeam";
  text: string;
}

const DAY = 86_400_000;

/** The flag for a limit with no Atlas document, or null when it earns none. `origin` is null while the history loads or holds no row. */
export function unmatchedFlag(origin: OriginKind | null | undefined, setTime: string, off: boolean, now: number, named = false): AtlasFlag | null {
  if (off || !origin) return null;
  const date = setTime.slice(0, 10);
  // With a document naming the limit's controller constant beside the name, the limit does have a document, just none whose value was connected.
  const lead = named ? "No Atlas value is connected to this limit (the document linked in its name only names its controller constant)" : "No Atlas document found for this limit";
  const cause = named ? "Either Redline Portal could not connect a value in it to this limit, or the Atlas does not state one." : "Either Redline Portal did not connect it to a document, or the Atlas does not state it.";
  if (origin === "spell" || origin === "relayed") {
    return { kind: "spell", text: `${lead}, set by a spell on ${date}. ${cause} A Prime Spell's changes are ratified into the Atlas before the spell goes to an Executive Vote (A.1.10.2.3.2.2.3.3.5).` };
  }
  if (origin === "operator" && now - Date.parse(setTime) > CBEAM_LAG_DAYS * DAY) {
    return { kind: "cbeam", text: `${lead}, set through the Configurator (a cBEAM) on ${date}, more than 2 months ago. A cBEAM change does not wait for an Executive Vote (A.1.10.3.2.10.5), so the Atlas may be behind, may not state this limit, or Redline Portal may not have connected it.` };
  }
  return null;
}
