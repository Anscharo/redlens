// Fragment ids on an actor page that search results link to. Instance ids are
// UUID-based; section ids are fixed lowercase words that cannot collide with
// category ids (`toAnchorId` of a title), primitive `st` slugs, `<st>-<status>`,
// `msc`.

export const instanceAnchor = (id: string): string => `instance-${id}`;

/** The id a retired fragment now lands on: `#invocations-<primitive>` is the
 *  primitive's block, `#invocations` and `#instances` are the page's list. */
export function legacyAnchor(id: string): string {
  if (id === "invocations" || id === "instances") return "primitives";
  return id.startsWith("invocations-") ? id.slice("invocations-".length) : id;
}

export const RADAR_SECTION = {
  responsibilities: "responsibilities",
  primitives: "primitives",
  relationships: "relationships",
  notable: "notable",
  history: "history",
  rewards: "rewards",
  pau: "pau",
} as const;
