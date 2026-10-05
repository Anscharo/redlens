// Fragment ids on an actor page that search results link to. Instance ids are
// UUID-based; section ids are fixed lowercase words that cannot collide with
// category ids (`toAnchorId` of a title), primitive `st` slugs, `<st>-<status>`,
// `msc`, `instances` or `invocations`.

export const instanceAnchor = (id: string): string => `instance-${id}`;

export const RADAR_SECTION = {
  responsibilities: "responsibilities",
  primitives: "primitives",
  relationships: "relationships",
  notable: "notable",
  history: "history",
  rewards: "rewards",
} as const;
