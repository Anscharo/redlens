// The subpages a Radar actor page splits into, in nav order. A Prime Agent's
// Info page (/radar/<slug>) keeps its profile; each entry here is its own
// route, /radar/<slug>/<key>. The nav, the route, the document title, the
// visit-log label and the chat's page context all read this one list.

export interface ActorPageDef {
  /** Path segment after the actor slug. */
  key: string;
  /** Sub nav label. */
  label: string;
  /** Page heading; also names the page in titles, the visit log and chat. */
  title: string;
}

export const ACTOR_PAGES = [
  { key: "settlements", label: "Settlements", title: "Monthly settlements" },
  { key: "history", label: "History", title: "History of doc changes" },
  { key: "primitives", label: "Primitives", title: "Primitives" },
  { key: "pau", label: "PAUs", title: "Parallelized Allocation Units" },
] as const satisfies readonly ActorPageDef[];

export type ActorPageKey = (typeof ACTOR_PAGES)[number]["key"];

const BY_KEY = new Map<string, ActorPageDef>(ACTOR_PAGES.map((p) => [p.key, p]));

export const isActorPageKey = (s: string | undefined): s is ActorPageKey => s !== undefined && BY_KEY.has(s);

/** Retired path segments, each mapped to the subpage that replaced it, so old
 *  links keep landing. */
const LEGACY_PAGE_KEYS: Readonly<Record<string, ActorPageKey>> = { instances: "primitives" };

export const legacyActorPageKey = (s: string | undefined): ActorPageKey | undefined =>
  s === undefined ? undefined : LEGACY_PAGE_KEYS[s];

export const actorPageDef = (key: ActorPageKey): ActorPageDef => BY_KEY.get(key)!;

/** Only Prime Agents split into subpages; every other actor keeps one page. */
export const hasActorPages = (e: { et: string; st: string | null | undefined }): boolean =>
  e.et === "agent" && e.st === "prime";
