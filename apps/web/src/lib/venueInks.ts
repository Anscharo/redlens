// Venue colours shared by a Prime's settlement circle and its AUM bars, so
// a venue wears one colour in both. Colours are chosen for the month's
// layout, not hashed from the venue: walking the venues largest first,
// each takes a slot none of its neighbours has — neighbours being bands
// stacked next to each other in the circle (either side of the Prime) and
// rows next to each other in the AUM list — preferring the slot used least
// so far. So two venues side by side never share a colour, or wear the one
// pair of slots that read alike.
const SLOTS = 5;
/** Slot pairs too alike to sit side by side: violet and magenta, yellow and
 *  olive, the two closest pairs in every theme (see --msc-venue-N). */
const ALIKE: Record<number, number[]> = { 0: [3], 3: [0], 2: [4], 4: [2] };
/** Folded tails ("Other venues") are grey in every chart. */
const OTHER_IDS = new Set(["_other", "_arc_other"]);

function neighbours(sequences: readonly (readonly string[])[]): Map<string, Set<string>> {
  const near = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!near.has(a)) near.set(a, new Set());
    near.get(a)!.add(b);
  };
  for (const seq of sequences) {
    for (let i = 1; i < seq.length; i++) {
      link(seq[i - 1], seq[i]);
      link(seq[i], seq[i - 1]);
    }
  }
  return near;
}

/** Each venue's `var(--msc-venue-N)`, or grey for a folded tail. `order` is
 *  who chooses first (largest first); `sequences` are the stacks and lists
 *  whose adjacent members must differ. */
export function venueInks(order: readonly string[], sequences: readonly (readonly string[])[]): Map<string, string> {
  const near = neighbours(sequences);
  const slot = new Map<string, number>();
  const used = new Array<number>(SLOTS).fill(0);
  const ids = [...new Set([...order, ...sequences.flat()])].filter((id) => !OTHER_IDS.has(id));
  for (const id of ids) {
    const taken = [...(near.get(id) ?? [])].map((n) => slot.get(n)).filter((s): s is number => s !== undefined);
    const clash = (s: number) => taken.includes(s);
    const alike = (s: number) => taken.some((t) => ALIKE[t]?.includes(s));
    const bySparing = [...Array(SLOTS).keys()].sort((a, b) => used[a] - used[b] || a - b);
    const pick = bySparing.find((s) => !clash(s) && !alike(s)) ?? bySparing.find((s) => !clash(s)) ?? bySparing[0];
    slot.set(id, pick);
    used[pick]++;
  }
  const inks = new Map<string, string>();
  for (const id of OTHER_IDS) inks.set(id, "var(--gray)");
  for (const [id, s] of slot) inks.set(id, `var(--msc-venue-${s + 1})`);
  return inks;
}
