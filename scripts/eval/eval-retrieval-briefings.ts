// Briefing arms for eval-retrieval.ts: loading the briefing file, the candidate
// pool, the block text of each arm, and the second index the s2 and s2docs arms rank over.
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { unitHash, type EmbedUnit } from "../../src/server/retrieval/embed-units.ts";
import { briefingEmbedText } from "../lib/doc-briefings.mjs";
import { competingSets, fullyCovered } from "./eval-briefing-coverage.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";
import { cosine, dot, idfMap, tfidfVec, tokenize } from "./eval-retrieval-rank.ts";
import { resolveVectors } from "./eval-retrieval-vectors.ts";
import { sampleDocs, samplePool } from "./eval-retrieval-sample.ts";
import {
  BACKEND, BRIEFING_ARMS, BRIEFING_FILE, BRIEFING_TEXTS, NEEDS_BRIEFINGS, POOL_FLAG, ROOT, SAMPLE_AGENT, SAMPLE_SCOPE,
  type BriefingArmName, type BriefingText,
} from "./eval-retrieval-flags.ts";

export interface BriefingRow {
  briefing: string;
  questions?: string[];
}

export interface Arm {
  name: BriefingArmName;
  text: BriefingText | null;
  label: string;
}

export const ARMS: Arm[] = BRIEFING_ARMS.flatMap((name) =>
  name === "none"
    ? [{ name, text: null, label: "none" } as Arm]
    : BRIEFING_TEXTS.map((text) => ({ name, text, label: `${name}:${text}` }) as Arm),
);

// "both" is the production recipe itself (sync-briefings embeds the same text),
// so the numbers measured here are the ones the stored vectors can reach.
export const blockOf = (row: BriefingRow, mode: BriefingText): string =>
  mode === "briefing" ? row.briefing : mode === "questions" ? (row.questions ?? []).join("\n") : briefingEmbedText(row);

// Which documents have a briefing, and what pool the run may draw from. A pilot
// covers part of the atlas, so a briefing arm scored over everything would reward a
// document for being covered rather than for being right.
export function loadBriefingPool(docs: AtlasNode[], docMap: Map<string, AtlasNode>) {
  const briefings = new Map<string, BriefingRow>();
  if (NEEDS_BRIEFINGS || POOL_FLAG === "covered") {
    if (!fs.existsSync(BRIEFING_FILE)) {
      console.error(`briefing file not found: ${BRIEFING_FILE}\n  pass --briefing-file <path> (default public/doc-briefings.json), or drop the briefing arms.`);
      process.exit(1);
    }
    const file = JSON.parse(fs.readFileSync(BRIEFING_FILE, "utf8")) as { briefings?: Record<string, BriefingRow> };
    for (const [id, row] of Object.entries(file.briefings ?? {})) {
      if (docMap.has(id) && typeof row?.briefing === "string") briefings.set(id, row);
    }
  }
  const covered: ReadonlySet<string> = new Set(briefings.keys());
  const fullCoverage = covered.size >= docs.length;
  const POOL: "all" | "covered" = (POOL_FLAG as "all" | "covered" | undefined) ?? (NEEDS_BRIEFINGS && !fullCoverage ? "covered" : "all");
  if (briefings.size > 0) {
    const why = POOL_FLAG
      ? "set by --pool"
      : POOL === "covered"
        ? `default: ${covered.size} of ${docs.length} documents have a briefing`
        : fullCoverage
          ? "default: every document has a briefing"
          : "default: no briefing arm requested";
    console.log(`briefings: ${covered.size}/${docs.length} documents from ${path.relative(ROOT, BRIEFING_FILE)}; pool=${POOL} (${why})`);
    if (POOL === "all" && NEEDS_BRIEFINGS && !fullCoverage) {
      console.warn(
        `  ⚠⚠ --pool all with PARTIAL briefing coverage (${covered.size}/${docs.length}): briefing arms are biased toward covered documents. A covered document gets a signal its uncovered competitor does not, so a gain here is not evidence the briefings help. Use --pool covered.`,
      );
    }
  }
  return { briefings, covered, POOL };
}

// The pool: under `covered`, units whose anchor and every member have a briefing,
// and queries whose whole competing set does. Applied to EVERY arm, `none` too,
// so the arms differ only in what they are given. Prints the coverage report.
export function selectPool(
  docs: AtlasNode[],
  allUnits: EmbedUnit[],
  queries: RetrievalQuery[],
  covered: ReadonlySet<string>,
  pool: "all" | "covered",
) {
  const poolUnits =
    pool === "covered" ? allUnits.filter((u) => covered.has(u.anchorId) && u.memberIds.every((id) => covered.has(id))) : allUnits;
  const competing = pool === "covered" ? competingSets(docs, allUnits, queries) : null;
  const scoredQueries = competing ? queries.filter((q) => fullyCovered(competing.get(q.id), covered)) : queries;
  if (covered.size > 0) {
    const perSlice = new Map<string, { scored: number; total: number }>();
    for (const q of queries) perSlice.set(q.slice, { scored: 0, total: 0, ...perSlice.get(q.slice) });
    for (const q of queries) perSlice.get(q.slice)!.total++;
    for (const q of scoredQueries) perSlice.get(q.slice)!.scored++;
    console.log(
      `  coverage: queries scored ${scoredQueries.length}/${queries.length}  units in pool ${poolUnits.length}/${allUnits.length}  documents covered ${covered.size}/${docs.length}`,
    );
    for (const [sl, c] of perSlice) console.log(`    ${sl}: queries scored ${c.scored}/${c.total}`);
  }
  return { poolUnits, scoredQueries };
}

let sample: Set<string> | null | undefined;

/** The run's pool: the sample's when --sample-scope is set, else selectPool's. */
export function choosePool(
  docs: AtlasNode[],
  units: EmbedUnit[],
  queries: RetrievalQuery[],
  covered: ReadonlySet<string>,
  pool: "all" | "covered",
) {
  if (sample === undefined) sample = SAMPLE_SCOPE === undefined ? null : sampleDocs(docs, SAMPLE_SCOPE, SAMPLE_AGENT ?? SAMPLE_SCOPE);
  return sample ? samplePool(docs, units, queries, sample) : selectPool(docs, units, queries, covered, pool);
}

// s1: the block rides in the unit's own text, so one vector carries both.
export function prependBlocks(units: EmbedUnit[], block: (id: string) => string | undefined): EmbedUnit[] {
  return units.map((u) => {
    const b = block(u.anchorId);
    if (b === undefined) return u;
    const text = `${b}\n\n${u.text}`;
    return { ...u, text, hash: unitHash(text) };
  });
}

// A second, independent index over a list of texts (the briefing blocks): rank(query)
// returns the ids best-first. TF-IDF builds its own idf over these texts; neural
// resolves one vector per distinct text through the cache.
export interface BlockIndex {
  ids: string[];
  rank(query: string, queryVec: number[] | null, k: number): string[];
}

async function buildBlockIndex(ids: string[], texts: string[], model: string, what: string): Promise<BlockIndex> {
  if (BACKEND === "tfidf") {
    const toks = texts.map(tokenize);
    const idf = idfMap(toks);
    const vecs = toks.map((t) => tfidfVec(t, idf));
    return {
      ids,
      rank(query, _qv, k) {
        const qv = tfidfVec(tokenize(query), idf);
        return ids
          .map((id, i) => ({ id, score: cosine(qv, vecs[i]!) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map((r) => r.id);
      },
    };
  }
  const byHash = new Map(texts.map((t) => [unitHash(t), t]));
  const got = await resolveVectors(byHash, model, what);
  const vecs = texts.map((t) => got.get(unitHash(t)) ?? []);
  return {
    ids,
    rank(_query, qv, k) {
      if (!qv) return [];
      return ids
        .map((id, i) => ({ id, score: vecs[i]!.length ? dot(qv, vecs[i]!) : -Infinity }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((r) => r.id);
    },
  };
}

// s2: a second ranking over the anchors' blocks alone. s2docs: a ranking over
// every covered document in the pool, folded members included.
export async function blockIndexFor(
  arm: Arm,
  units: EmbedUnit[],
  block: (id: string) => string | undefined,
  model: string,
  policy: string,
): Promise<BlockIndex | null> {
  if (arm.name === "s2") {
    const ids = units.filter((u) => block(u.anchorId) !== undefined).map((u) => u.anchorId);
    return buildBlockIndex(ids, ids.map((id) => block(id)!), model, `${policy} ${arm.label} anchor blocks`);
  }
  if (arm.name === "s2docs") {
    const ids = [...new Set(units.flatMap((u) => [u.anchorId, ...u.memberIds]))].filter((id) => block(id) !== undefined);
    return buildBlockIndex(ids, ids.map((id) => block(id)!), model, `${policy} ${arm.label} document blocks`);
  }
  return null;
}
