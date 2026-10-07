// Reads the vote.sky.money portal API: enactment state per executive (keyed
// by spell address) and pollId / slug / outcome per poll (keyed by the poll
// file's path). The fetcher is injected so the paging and normalising rules
// are testable offline.

import type { ExecutivePortal, PollPortal } from "./types.ts";

export const PORTAL_API = "https://vote.sky.money/api";
// The portal returns at most 30 rows per page whatever pageSize or limit asks for.
export const PAGE_SIZE = 30;
// A runaway-loop bound, far above any real page count.
const MAX_PAGES = 100;

export type FetchJson = (url: string) => Promise<unknown>;

export interface PortalData {
  executivesByAddress: Map<string, ExecutivePortal>;
  pollsByPath: Map<string, PollPortal>;
}

interface RawExecutive {
  address: string;
  key: string;
  date: string;
  active?: boolean;
  spellData?: { hasBeenCast?: boolean; datePassed?: string | null; dateExecuted?: string | null };
}

interface RawPoll {
  pollId: number;
  slug: string;
  multiHash: string;
  url?: string;
  tags?: Array<string | { id: string }>;
  tally?: { winningOptionName?: string | null; numVoters?: number | null } | null;
}

interface RawPollPage {
  paginationInfo: { totalCount: number; numPages: number };
  polls: RawPoll[];
}

export async function readPortal(fetchJson: FetchJson): Promise<PortalData> {
  const [executives, polls] = await Promise.all([fetchExecutives(fetchJson), fetchPolls(fetchJson)]);
  const executivesByAddress = new Map<string, ExecutivePortal>();
  for (const e of executives) executivesByAddress.set(e.address.toLowerCase(), toExecutivePortal(e));
  const pollsByPath = new Map<string, PollPortal>();
  for (const p of polls) {
    const key = pollPathFromUrl(p.url ?? "");
    if (key) pollsByPath.set(key, toPollPortal(p));
  }
  return { executivesByAddress, pollsByPath };
}

// The executive endpoint reports no total, so paging stops at the first short page.
async function fetchExecutives(fetchJson: FetchJson): Promise<RawExecutive[]> {
  const rows: RawExecutive[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${PORTAL_API}/executive?network=mainnet&start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch)) throw new Error(`votes: ${url} did not return an array`);
    rows.push(...(batch as RawExecutive[]));
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error(`votes: executive paging passed ${MAX_PAGES} pages without a short page`);
}

// The poll endpoint reports its total; a fetch that collects fewer rows is truncated, not small.
async function fetchPolls(fetchJson: FetchJson): Promise<RawPoll[]> {
  const rows: RawPoll[] = [];
  let total = Infinity;
  let numPages = 1;
  for (let page = 1; page <= numPages && page <= MAX_PAGES; page++) {
    const url = `${PORTAL_API}/polling/all-polls-with-tally?network=mainnet&pageSize=${PAGE_SIZE}&page=${page}`;
    const body = (await fetchJson(url)) as RawPollPage;
    if (!body?.paginationInfo || !Array.isArray(body.polls)) throw new Error(`votes: ${url} is not a poll page`);
    ({ totalCount: total, numPages } = body.paginationInfo);
    rows.push(...body.polls);
  }
  if (rows.length !== total) {
    throw new Error(`votes: portal reported ${total} polls but paging collected ${rows.length}`);
  }
  return rows;
}

/**
 * "<year>/<yyyy-mm-dd>-<slug>.md" from a poll's raw
 * GitHub url. The org is ignored: early polls still point at makerdao/polls,
 * the same repository under its former owner, with the same paths.
 */
export function pollPathFromUrl(url: string): string | null {
  const m = /\/(\d{4}\/[^/]+\.md)$/.exec(decodeURIComponent(url));
  return m ? m[1] : null;
}

function toExecutivePortal(e: RawExecutive): ExecutivePortal {
  const sd = e.spellData ?? {};
  return {
    key: e.key,
    date: e.date,
    active: Boolean(e.active),
    hasBeenCast: Boolean(sd.hasBeenCast),
    datePassed: sd.datePassed ?? null,
    dateExecuted: sd.dateExecuted ?? null,
  };
}

function toPollPortal(p: RawPoll): PollPortal {
  return {
    pollId: p.pollId,
    slug: p.slug,
    multiHash: p.multiHash,
    tags: (p.tags ?? []).map((t) => (typeof t === "string" ? t : t.id)),
    winner: p.tally?.winningOptionName ?? null,
    numVoters: p.tally?.numVoters ?? null,
  };
}
