// The verified source of every spell behind a stored PAU change, kept as its
// naming material (source-material.ts) for the rate-limit key namer. A
// change's origin names the DssSpell that cast it and the star spell it ran
// (pau_tx_origin), and a spell that declares another spell or payload
// (`SPARK_SPELL`) queues that one too. Each is read once and kept in
// pau_spell_sources, because the worker's container starts without the
// explorer cache it fetched last run; one no explorer has verified is asked
// again after UNVERIFIED_RETRY_MS, and one read under another MATERIAL_VERSION
// is read again. Spells are Ethereum contracts, so every row is chain
// "ethereum".
import { EVM_ADDRESS_EXACT_RE } from "../../lib/patterns.ts";
import type { SqlTag } from "../sql-types.ts";
import { MATERIAL_VERSION, materialOf, mergeMaterial, type SourceMaterial } from "./source-material.ts";

export const UNVERIFIED_RETRY_MS = 7 * 86_400_000;
const CHAIN = "ethereum";

/** One explorer answer: an empty contract name means no verified source. */
export type SourceFetch = (address: string) => Promise<{ contractName: string; sourceCode: string }>;

interface StoredSource {
  address: string;
  contractName: string;
  material: SourceMaterial;
  version: number;
  fetchedAt: number;
}

async function storedSources(db: SqlTag): Promise<StoredSource[]> {
  const rows = (await db`SELECT address, contract_name, material, parser_version, fetched_at FROM pau_spell_sources WHERE chain = ${CHAIN}`) as Record<string, unknown>[];
  return rows.map((r) => ({
    address: String(r.address),
    contractName: String(r.contract_name),
    material: (typeof r.material === "string" ? JSON.parse(r.material) : r.material) as SourceMaterial,
    version: Number(r.parser_version),
    fetchedAt: new Date(r.fetched_at as string | Date).getTime(),
  }));
}

/** The spells to read: each origin's spell and star spell and each spell a stored source declares, unless stored under this MATERIAL_VERSION, verified or asked within UNVERIFIED_RETRY_MS. */
export async function spellsToRead(db: SqlTag, now: number): Promise<string[]> {
  const origins = (await db`
    SELECT spell AS address FROM pau_tx_origin WHERE spell IS NOT NULL
    UNION SELECT star_spell FROM pau_tx_origin WHERE star_spell IS NOT NULL`) as { address: string }[];
  const have = await storedSources(db);
  const settled = new Set(have.filter((s) => s.version === MATERIAL_VERSION && (s.contractName || now - s.fetchedAt < UNVERIFIED_RETRY_MS)).map((s) => s.address));
  const wanted = [...origins.map((r) => r.address), ...have.flatMap((s) => s.material.spells)].map((a) => a.toLowerCase());
  return [...new Set(wanted)].filter((a) => EVM_ADDRESS_EXACT_RE.test(a) && !settled.has(a)).sort();
}

async function saveSource(db: SqlTag, address: string, contractName: string, material: SourceMaterial, at: Date): Promise<void> {
  await db`
    INSERT INTO pau_spell_sources (chain, address, contract_name, material, parser_version, fetched_at)
    VALUES (${CHAIN}, ${address}, ${contractName}, ${material}::jsonb, ${MATERIAL_VERSION}, ${at})
    ON CONFLICT (chain, address) DO UPDATE
      SET contract_name = excluded.contract_name, material = excluded.material, parser_version = excluded.parser_version, fetched_at = excluded.fetched_at`;
}

/**
 * Reads pending spells' sources, at most `max` and until `deadline`. An
 * explorer failure ends the run and is reported; that spell stays queued. A
 * spell a new source declares is queued for the next run.
 */
export async function syncSpellSources(db: SqlTag, fetchSource: SourceFetch, opts: { deadline: number; max: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const queue = await spellsToRead(db, now());
  let read = 0;
  let error: string | null = null;
  for (const address of queue) {
    if (read >= opts.max || now() >= opts.deadline) break;
    try {
      const src = await fetchSource(address);
      await saveSource(db, address, src.contractName, materialOf(src.sourceCode), new Date(now()));
      read++;
    } catch (e) {
      error = (e as Error).message;
      break;
    }
  }
  return { read, pending: queue.length - read, error };
}

/** Every stored spell's naming material, as one. */
export async function spellMaterial(db: SqlTag): Promise<SourceMaterial> {
  return mergeMaterial((await storedSources(db)).map((s) => s.material));
}
