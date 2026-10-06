// GET /api/collections/:id/summary — a generated group name and one-line summary
// for one of the caller's collections. One cheap title-model call per distinct
// doc set: the result is stored next to the collection under the hash of its
// ids, so repeat reads cost one query and an edited collection is rewritten.
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { getSessionUser } from "./session.ts";
import { json } from "./http.ts";
import { UUID_RE } from "../lib/patterns.ts";
import { itemsFor } from "./collections.ts";
import { getIndexes, type Indexes } from "./retrieval/indexes.ts";
import { callWithTimeout, makeOpenrouterJson, type JsonCall } from "./chat/llm.ts";
import { captureError } from "./posthog-node.ts";
import { buildSummaryPrompt, idsHash, parseSummary, summaryInput, type CollectionSummary } from "./collection-summary-prompt.ts";

interface StoredSummary {
  summary_label: string | null;
  summary_text: string | null;
  summary_hash: string | null;
}

// No usage_events row: like titling, this is a system call on the user's behalf
// and must not charge their chat budget. A miss (model off, timeout, unparseable
// answer) is null and is not stored, so the next read tries again.
// `deps` is the test seam: the model call and the atlas indexes.
export interface SummaryDeps {
  call?: JsonCall;
  ix?: Indexes;
}

export async function summarizeIds(ids: readonly string[], deps: SummaryDeps = {}): Promise<CollectionSummary | null> {
  const call = deps.call ?? makeOpenrouterJson({}, "atlas-collection-summary");
  const model = config.chatTitleModel;
  if (!model || !ids.length) return null;
  const input = summaryInput(deps.ix ?? getIndexes(), ids);
  if (!input.total) return null;
  try {
    const res = await callWithTimeout(call, { model, messages: buildSummaryPrompt(input), maxTokens: 120 }, config.chatTitleTimeoutMs);
    return parseSummary(res.text);
  } catch (err) {
    captureError(err, {}, { stage: "collection-summary" });
    return null;
  }
}

const NONE = { label: null, summary: null };

async function readSummary(userId: string, id: string): Promise<{ ids: string[]; stored: StoredSummary } | null> {
  const rows = (await sql`
    SELECT summary_label, summary_text, summary_hash FROM collections WHERE id = ${id} AND user_id = ${userId}
  `) as StoredSummary[];
  return rows.length ? { ids: await itemsFor(id), stored: rows[0] } : null;
}

// null: not one of the caller's collections.
async function summaryFor(userId: string, id: string, deps: SummaryDeps): Promise<typeof NONE | CollectionSummary | null> {
  const found = await readSummary(userId, id);
  if (!found) return null;
  const hash = idsHash(found.ids);
  const { summary_label: label, summary_text: text, summary_hash: stored } = found.stored;
  if (stored === hash && label && text) return { label, summary: text };
  const made = await summarizeIds(found.ids, deps);
  if (!made) return NONE;
  await sql`
    UPDATE collections SET summary_label = ${made.label}, summary_text = ${made.summary}, summary_hash = ${hash}
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return made;
}

export async function handleCollectionSummary(req: Request, deps: SummaryDeps = {}): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const id = new URL(req.url).pathname.match(/^\/api\/collections\/([^/]+)\/summary$/)?.[1];
  if (!id || !UUID_RE.test(id)) return json({ error: "not_found" }, 404);
  try {
    const out = await summaryFor(session.user.id, id, deps);
    return out ? json(out, 200, session.refresh) : json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "server_error" }, 500);
  }
}
