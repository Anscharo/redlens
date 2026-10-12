// GET /api/pau/history → PauHistoryResponse: every stored PAU configuration
// change, one entry per transaction, with its origin (origin.ts) and, for a
// spell, its executive. Titles come from the vote record (votes.json) and, for
// spells older than it, from the verified executive archive (vote-archive.ts);
// a spell in neither keeps its address alone.
import type { ExecutiveRef, PauHistoryResponse, PauOrigin } from "../../lib/pauHistory.ts";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import registry from "../../data/pau-registry.json" with { type: "json" };
import { sql } from "../db.ts";
import { json } from "../http.ts";
import type { SqlTag } from "../sql-types.ts";
import { loadVoteIndexFromDisk } from "../votes.ts";
import { ARCHIVE_BLOB } from "./vote-archive.ts";
import { buildEntries, ownersOf, type EventRow } from "./history-entries.ts";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

async function eventRows(db: SqlTag): Promise<EventRow[]> {
  const rows = (await db`SELECT chain, tx_hash, contract, event, args, block, block_time FROM pau_events ORDER BY block, log_index`) as Record<string, unknown>[];
  return rows.map((r) => ({
    chain: String(r.chain), tx: String(r.tx_hash), contract: String(r.contract), event: String(r.event),
    args: parse(r.args) as Record<string, unknown>, block: Number(r.block), time: iso(r.block_time),
  }));
}

async function originRows(db: SqlTag): Promise<Map<string, PauOrigin>> {
  const rows = (await db`SELECT * FROM pau_tx_origin`) as Record<string, unknown>[];
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return new Map(rows.map((r) => [`${r.chain}:${r.tx_hash}`, {
    kind: r.kind as PauOrigin["kind"], path: str(r.path) as PauOrigin["path"], spell: str(r.spell), starSpell: str(r.star_spell),
    l1Tx: str(r.l1_tx), from: str(r.tx_from), to: str(r.tx_to), relay: (parse(r.relay) ?? null) as PauOrigin["relay"], evidence: String(r.evidence),
  }]));
}

/** Each spell's executive: the vote record first, then the verified archive, else the bare spell. */
type VoteRecord = () => { executives: { spell: string | null; title: string; date: string; url: string }[] } | null;

async function executives(db: SqlTag, votes: VoteRecord): Promise<(spell: string) => ExecutiveRef> {
  const record = new Map<string, ExecutiveRef>();
  for (const e of votes()?.executives ?? []) {
    if (e.spell) record.set(e.spell.toLowerCase(), { title: e.title, date: e.date, url: e.url, source: "vote-record" });
  }
  const rows = (await db`SELECT file, spell, title, date FROM executive_archive WHERE status = 'verified'`) as Record<string, string>[];
  const archive = new Map(rows.map((r) => [r.spell, { title: r.title, date: r.date, url: ARCHIVE_BLOB + encodeURIComponent(r.file), source: "archive" as const }]));
  return (spell) => record.get(spell) ?? archive.get(spell) ?? { title: null, date: null, url: null, source: null };
}

/** Every change to a prime's PAU; changes to shared contracts alone (a Beacon's setup) belong to no prime's history. */
export async function readPauHistory(db: SqlTag = sql, votes: VoteRecord = loadVoteIndexFromDisk, reg = registry as PauRegistry): Promise<PauHistoryResponse> {
  const [rows, origins, executiveOf] = await Promise.all([eventRows(db), originRows(db), executives(db, votes)]);
  return { entries: buildEntries(rows, ownersOf(reg), origins, executiveOf).filter((e) => e.primes.length > 0) };
}

const HEADERS = { "Cache-Control": "public, max-age=300", Vary: "Accept-Encoding" };

/** How long a built history is served before the database is asked whether it changed. */
const RECHECK_MS = 60_000;

/**
 * What the history is built from, as one string a change to any input moves:
 * an event added, an origin resolved again, an archive entry checked. The vote
 * record is read from disk and changes only with a deploy, which restarts the
 * process.
 */
async function inputsVersion(db: SqlTag): Promise<string> {
  const rows = (await db`SELECT
    (SELECT count(*) FROM pau_events)::text AS events_version, (SELECT max(block) FROM pau_events)::text AS head,
    (SELECT count(*) FROM pau_tx_origin)::text AS origins, (SELECT max(resolved_at) FROM pau_tx_origin)::text AS resolved,
    (SELECT max(checked_at) FROM executive_archive)::text AS archive`) as Record<string, unknown>[];
  return Object.values(rows[0] ?? {}).join("|");
}

interface Built {
  json: string;
  gzip: () => Uint8Array;
}

function build(body: PauHistoryResponse): Built {
  const json = JSON.stringify(body);
  let gz: Uint8Array | undefined;
  return { json, gzip: () => (gz ??= Bun.gzipSync(json)) };
}

let cache: { version: string; checkedAt: number; built: Promise<Built> } | null = null;
let checking: Promise<Built> | null = null;

/** The history as last built, rebuilt only when its inputs moved; one check runs at a time, and a failed build is not kept. */
async function currentHistory(): Promise<Built> {
  if (cache && Date.now() - cache.checkedAt < RECHECK_MS) return cache.built;
  checking ??= (async () => {
    const version = await inputsVersion(sql);
    if (cache?.version === version) cache.checkedAt = Date.now();
    else {
      const entry = { version, checkedAt: Date.now(), built: readPauHistory().then(build) };
      cache = entry;
      entry.built.catch(() => {
        if (cache === entry) cache = null;
      });
    }
    return cache!.built;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Forgets the built history (tests). */
export function resetPauHistoryCache(): void {
  cache = null;
  checking = null;
}

// Public, ungated, like /api/pau: an empty list until the worker has run. The
// full history is several hundred kilobytes of repetitive JSON, built once per
// change of its inputs and gzipped once for every client that accepts it.
export async function handlePauHistory(req?: Request): Promise<Response> {
  try {
    const built = await currentHistory();
    if (!req?.headers.get("accept-encoding")?.includes("gzip")) {
      return new Response(built.json, { status: 200, headers: { ...HEADERS, "content-type": "application/json" } });
    }
    const headers = { ...HEADERS, "content-type": "application/json", "content-encoding": "gzip" };
    return new Response(built.gzip(), { status: 200, headers });
  } catch (e) {
    console.error(`pau history: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
