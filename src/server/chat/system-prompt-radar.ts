// What each Radar page shows and which tool reads it, for the chat system
// prompt's current-page section. One entry per page in src/lib/radarPages.ts,
// so a new subpage does not compile until it says how the chat reads it. This
// is Redline Portal's description of its own pages, not Atlas text.
import { hasActorPages, isActorPageKey, type ActorPageKey } from "../../lib/radarPages.ts";
import { ROUTES } from "../../lib/routes.ts";
import type { Indexes } from "../retrieval/indexes.ts";

const SLUG = /^[a-z0-9-]{1,64}$/;

type PageKey = ActorPageKey | "info";

/** The tool argument naming the actor: the slug, quoted. */
type Arg = string;

const PAGE_GUIDE: Record<PageKey, (a: Arg) => string> = {
  info: (a) =>
    `This is the actor's profile, from Redline Portal's extraction: what it is, the parties it is linked to, its responsibilities, rewards and contact. Read it with atlas_entity name=${a}.`,
  history: (a) =>
    `The page lists every Atlas commit that changed a document about this actor. Read it with atlas_recent_changes entity=${a} and a since date. Without since it covers 30 days. These are Atlas edits. A change made on chain is redline_liquidity_changes.`,
  primitives: (a) =>
    `The page lists this Prime's primitives, their invocations and instances, and each instance's parameters with a mark for whether the chain agrees. Its instances and their documents: atlas_entity name=${a}. One instance's parameter values: atlas_entity_params. The marks: redline_onchain entity=${a} with kind "atlas-vs-contract". relation "differs" keeps the ones that disagree.`,
  // The settlements line and the Liquidity Layer block carry their own calls
  // (system-prompt-page.ts, system-prompt-pau.ts). Those two pages get nothing
  // from here: with more text after its call, the model asks which figure is
  // meant instead of making the call (pnpm eval:tools, msc-page and radar-pau-spell).
  settlements: () => "",
  pau: () => "",
};

/** What a Prime's other pages hold, so a question about one of them asked from here reaches its tool. */
const primePages = (a: Arg) =>
  `This Prime has more pages. Liquidity Layer: its controller contracts on a Diamond PAU or a monolithic controller, who holds each role, the rate limits and the spells that set them. Read those with redline_onchain entity=${a} (kind "role" for role holders) and redline_liquidity_changes entity=${a}. Settlements: monthly dollar figures, from ask_external_msc. Primitives and History are atlas_entity and atlas_recent_changes.`;

const OUTSIDE_ARTIFACT =
  "Documents about this actor also sit outside its own artifact, such as a primitive's section titled with its name. When a search scoped by entity finds nothing, search again with the actor's name in the query before saying the Atlas does not cover it.";

const INDEX_GUIDE =
  " Radar's index is the primitive activation matrix: which Prime Agent has activated which primitive. Read it with atlas_report_primitive_matrix. The actor list beside it is atlas_entities.";

interface RadarCtx {
  actorSlug?: string;
  path?: string;
}

const subpage = (path: string | undefined) => path?.match(/\/radar\/[^/?#]+\/([^/?#]+)/)?.[1];

function isPrime(ix: Indexes | undefined, slug: string, sub: string | undefined): boolean {
  if (isActorPageKey(sub)) return true;
  const e = ix?.entityBySlug.get(slug);
  return !!e && hasActorPages({ et: e.entity_type, st: e.subtype });
}

/**
 * The guidance for a Radar page, or "" off Radar and on a page that carries
 * its own call. Non-empty on an actor page means "this" there is the actor. A slug that is not a slug
 * gets no guidance, so a hostile path cannot enter the prompt as an argument.
 */
export function radarPageBlock(ctx: RadarCtx | undefined, ix?: Indexes): string {
  if (!ctx?.path) return "";
  if (!ctx.actorSlug) return ctx.path.replace(/[?#].*$/, "").replace(/\/$/, "") === ROUTES.RADAR ? INDEX_GUIDE : "";
  const slug = ctx.actorSlug.trim().toLowerCase();
  if (!ctx.path.startsWith(`${ROUTES.RADAR}/`) || !SLUG.test(slug)) return "";
  const sub = subpage(ctx.path);
  const arg = `"${slug}"`;
  const own = PAGE_GUIDE[isActorPageKey(sub) ? sub : "info"](arg);
  if (!own) return "";
  return ` ${[own, isPrime(ix, slug, sub) ? primePages(arg) : "", OUTSIDE_ARTIFACT].filter(Boolean).join(" ")}`;
}
