import { CANONICAL_REPO } from "./resolve.ts";
import { gh } from "./resolve-id.ts";

// Open PRs against the canonical atlas, for the /preview index "open atlas prs"
// tab and the atlas_open_prs tool. Cached ~5 min — the pulls list is
// rate-limited and rarely changes, and many index visitors would otherwise each
// spend a GitHub call.
export interface OpenPr {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  headSha: string;
  baseRef: string;
  url: string;
  /** The PR's GitHub description, capped: the author's own account of the change. */
  body: string;
}

const BODY_MAX = 2000;
let openPrsCache: { at: number; v: OpenPr[] } | null = null;
const OPEN_PRS_TTL_MS = 5 * 60_000;

/** The open PRs, or null when GitHub did not answer and nothing is cached — so a
 *  tool can say "unavailable" rather than "there are none". */
export async function fetchOpenPrs(): Promise<OpenPr[] | null> {
  const now = Date.now();
  if (openPrsCache && now - openPrsCache.at < OPEN_PRS_TTL_MS) return openPrsCache.v;
  const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100`);
  if (!r.ok || !Array.isArray(r.json)) return openPrsCache?.v ?? null; // serve stale on a GitHub hiccup
  const prs: OpenPr[] = r.json.map((p: any) => ({
    number: p.number,
    title: p.title ?? "",
    author: p.user?.login ?? "",
    draft: !!p.draft,
    updatedAt: p.updated_at ?? "",
    headSha: p.head?.sha ?? "",
    baseRef: p.base?.ref ?? "",
    url: p.html_url ?? "",
    body: String(p.body ?? "").slice(0, BODY_MAX),
  }));
  openPrsCache = { at: now, v: prs };
  return prs;
}

/** The /preview index's list: an unanswered GitHub reads as an empty tab. */
export const openAtlasPrs = async (): Promise<OpenPr[]> => (await fetchOpenPrs()) ?? [];
