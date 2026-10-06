// Venue colours shared by a Prime's settlement circle and its AUM bars, so
// a venue wears one colour in both. The colour follows the venue, not its
// rank: its slot is hashed from its id, and a clash moves the later id (in
// id order) to the next free slot, so a venue keeps its colour as it
// re-ranks from month to month.
const SLOTS = 5;
/** Folded tails ("Other venues") are grey in every chart. */
const OTHER_IDS = new Set(["_other", "_arc_other"]);
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

/** Each venue's `var(--msc-venue-N)`. `first` (the circle's venues) take
 *  distinct slots before `rest` (venues only the AUM bars show); once the
 *  five slots are taken, a venue keeps its hashed slot and may share it. */
export function venueInks(first: readonly string[], rest: readonly string[] = []): Map<string, string> {
  const inks = new Map<string, string>();
  const taken = new Set<number>();
  const assign = (ids: readonly string[]) => {
    for (const id of [...new Set(ids)].sort()) {
      if (inks.has(id)) continue;
      if (OTHER_IDS.has(id)) {
        inks.set(id, "var(--gray)");
        continue;
      }
      let slot = hash(id) % SLOTS;
      for (let n = 0; taken.has(slot) && n < SLOTS; n++) slot = (slot + 1) % SLOTS;
      if (taken.size >= SLOTS) slot = hash(id) % SLOTS;
      taken.add(slot);
      inks.set(id, `var(--msc-venue-${slot + 1})`);
    }
  };
  assign(first);
  assign(rest);
  return inks;
}
