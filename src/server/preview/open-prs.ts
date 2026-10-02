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
}
let openPrsCache: { at: number; v: OpenPr[] } | null = null;
const OPEN_PRS_TTL_MS = 5 * 60_000;

export async function openAtlasPrs(): Promise<OpenPr[]> {
  const now = Date.now();
  if (openPrsCache && now - openPrsCache.at < OPEN_PRS_TTL_MS) return openPrsCache.v;
  const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100`);
  if (!r.ok || !Array.isArray(r.json)) return openPrsCache?.v ?? []; // serve stale on a GitHub hiccup
  const prs: OpenPr[] = r.json.map((p: any) => ({
    number: p.number,
    title: p.title ?? "",
    author: p.user?.login ?? "",
    draft: !!p.draft,
    updatedAt: p.updated_at ?? "",
    headSha: p.head?.sha ?? "",
    baseRef: p.base?.ref ?? "",
    url: p.html_url ?? "",
  }));
  openPrsCache = { at: now, v: prs };
  return prs;
}
