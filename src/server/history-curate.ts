// POST /api/history-curate/propose — LLM pre-proposal for the HTML-era history
// curation tool (plan §10.4). Given a NEWER document and OLDER candidate documents,
// the model picks which candidate is the newer doc's PREVIOUS version (or "none").
// Local-only: gated on an OpenRouter key being present (the curation file it drives
// is never shipped to prod). The LLM only PROPOSES — a human confirms, and the
// recorded decision is what the build applies, so this never touches determinism.

import fs from "node:fs";
import path from "node:path";
import { getClient, getModel } from "./llm.ts";
import { config } from "./config.ts";

// Fixed committed filename — the client never supplies a path (no traversal).
const DECISIONS_FILE = "history-decisions.json";

const SYSTEM =
  "You thread an atlas document's history. Given a NEWER document and several OLDER candidate documents, pick which OLDER candidate is the PREVIOUS version of the NEWER one (the same document, before edits), or \"none\" if the newer document is genuinely new. Content is EXPECTED to change between versions — values, wording, even a rename are normal edits, NOT evidence of a different document. A candidate may include CHANGES → newer: the exact line diff from it to the newer document (- deleted, + added); the true previous version shows a SMALL, COHERENT change while an unrelated document shows a large or incoherent diff — weight this heavily. Candidates may be NEAR-IDENTICAL (same title and body) and are told apart ONLY by their scope + position — the top-level scope the doc lives in (Governance, Support, Stability, Protocol, Accessibility, Agent) and the documents immediately before/after it, shown as 'scope:' / 'under:' (the owning process/element) / 'path:' / 'position: … ‹THIS› …'. Strongly prefer a candidate whose scope MATCHES the newer document's scope; for repeated boilerplate documents (identical bodies like 'Required Primitive Inputs'), the 'under:' owning process is the decisive signal — match it to the newer document's process. Use position/path to disambiguate stubs within a scope. A candidate may note that NO other document could continue it (so declining it here deletes that document) or that other documents also claim it. You may also be given THE CHANGE that produced the newer document (the PR + its forum proposal's edit-list): if it says the newer document's topic was 'Updated' or edited, a predecessor almost certainly exists (pick it); if 'Added'/new, lean 'none'. Judge by the change description and diff, then position, then title + subject/role + prose. Reply ONLY JSON: {\"chosenKey\":\"<one of the candidate keys>\"|\"none\",\"why\":\"<short>\"}.";

const clip = (text: string, max = 1200) => (text || "").slice(0, max);

// Some models (notably Anthropic via OpenRouter) ignore response_format:json_object and wrap the
// JSON in a prose preamble ("I'll analyze…") or ```json fences. Recover by extracting the outermost
// {…} object. Strict parse first (the common, compliant path); loose extraction only on failure.
function looseJsonParse(text: string): Record<string, unknown> {
  const s = (text || "").trim();
  try { return JSON.parse(s); } catch { /* not strict JSON — try to extract the object below */ }
  const m = s.match(/\{[\s\S]*\}/); // first '{' … last '}' — our schema is one top-level object
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up → {} */ } }
  return {};
}

export interface NodeContext {
  docNo?: string | null;
  prev: string[]; // neighbor titles, nearest-first
  next: string[];
  path?: string[]; // breadcrumb (section › ancestors) — disambiguates identical-title stubs
  scope?: string; // top-level scope (Governance | Support | …) from the doc_no prefix
  parent?: string; // owning process/element (nearest preceding breadcrumb doc) — for template children
}
// Render the scope + breadcrumb path + neighbor titles. Scope and path are the signals that
// separate identical-content-and-title stubs (e.g. a "Tau Current Value" under two modules, or
// an "Ambiguity" element in the Governance vs Support scope).
const posLine = (ctx?: NodeContext | null): string => {
  if (!ctx) return "";
  const chain = [...(ctx.prev ?? []).slice().reverse(), "‹THIS›", ...(ctx.next ?? [])].join(" » ");
  const scope = ctx.scope ? `\n  scope: ${ctx.scope}` : "";
  const parent = ctx.parent ? `\n  under: ${ctx.parent}` : "";
  const path = ctx.path?.length ? `\n  path: ${ctx.path.join(" › ")}` : "";
  return `${scope}${parent}${path}\n  position${ctx.docNo ? ` ${ctx.docNo}` : ""}: ${chain}`;
};

export interface ProposeSubject {
  title: string;
  content: string;
  context?: NodeContext | null;
}
export interface ProposeCandidate {
  key: string;
  title: string;
  content: string;
  diff?: string; // line changes from this candidate → the newer doc (history-diff.diffText), hop cases only
  context?: NodeContext | null; // structural neighbors — the only way to tell near-identical stubs apart
  soleHome?: boolean; // no other document lists this candidate → declining it deletes that document
  alsoClaimedBy?: number; // count of OTHER documents that also list this candidate
}
export interface ChangeContext {
  pr?: number | null;
  title?: string; // PR title
  summary?: string; // linked forum proposal's edit-list, or the PR body
}
export interface ProposeResult {
  chosenKey: string;
  why: string;
}

// The LLM proposal core, shared by the HTTP endpoint (human-in-the-loop UI) and the
// offline batch auto-curator (scripts/htmlhist/auto-curate-html-history.mjs) so the prompt
// lives in exactly one place. Returns the model's chosen candidate key (constrained to
// the supplied keys, else "none") + a short rationale. The model only PROPOSES — a
// human confirms in the UI, or the batch script only locks a case when the LLM agrees
// with an already-confident matcher pick — so this never touches build determinism.
export async function proposePredecessor(
  subject: ProposeSubject,
  candidates: ProposeCandidate[],
  opts: { model?: string; change?: ChangeContext | null } = {},
): Promise<ProposeResult> {
  const homeNote = (c: ProposeCandidate): string =>
    c.soleHome ? `\n  note: no other document lists this candidate — if not chosen here it is treated as DELETED.`
      : c.alsoClaimedBy ? `\n  note: also a candidate for ${c.alsoClaimedBy} other document(s).` : "";
  // The change (PR + linked forum proposal) that produced the newer doc: its edit-list names what was
  // Updated (a continuation) vs Added (a birth) — decisive for whether a predecessor exists at all.
  const ch = opts.change;
  const changeBlock = ch && (ch.title || ch.summary)
    ? `THE CHANGE that produced the newer document${ch.pr ? ` (PR #${ch.pr})` : ""}: ${ch.title || ""}` +
      `${ch.summary ? `\n${clip(ch.summary, 1400)}` : ""}\n\n`
    : "";
  const user =
    changeBlock +
    `NEWER document:\n[${subject.title}] ${clip(subject.content)}${posLine(subject.context)}\n\n` +
    `OLDER candidates (pick the one that is its previous version, or "none"):\n` +
    candidates
      .map((c) => `key=${c.key}\n[${c.title}] ${clip(c.content)}` +
        (c.diff ? `\nCHANGES → newer:\n${clip(c.diff, 800)}` : "") + posLine(c.context) + homeNote(c))
      .join("\n\n");

  const response = await getClient().chat.completions.create(
    {
      // opts.model lets the offline auto-curator escalate hard cases to a frontier model
      // (config.curationFrontierModel) while the page + cheap pass stay on getModel().
      model: opts.model ?? getModel(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    },
    { timeout: 30000, maxRetries: 1 },
  );
  const parsed = looseJsonParse(response.choices[0]?.message?.content ?? "{}");
  const raw = typeof parsed.chosenKey === "string" ? parsed.chosenKey : "none";
  const chosenKey = raw === "none" || candidates.some((c) => c.key === raw) ? raw : "none";
  return { chosenKey, why: typeof parsed.why === "string" ? parsed.why : "" };
}

// --- MATRIX pass: joint assignment over a cluster (plan §10.4 cluster enrichment) ----------
// Given a SET of newer documents that share candidates and a shared pool of older candidates,
// assign each newer doc to at most one older candidate (or "none"), honouring the constraint that
// each older candidate is used AT MOST ONCE. Seeing the whole cluster lets the model reason across
// siblings ("A is the DAI→USDC edit of C1, so B must be C2") and cover the mutual-exclusion the
// per-doc pass is blind to. Subjects/candidates are rendered as short ids (S1…/C1…) so the model
// never has to echo long content-hash keys — fewer JSON errors, smaller payload. Returns real keys.
const CLUSTER_SYSTEM =
  'You thread atlas document history. You are given a SET of NEWER documents (S1, S2, …) that are near-duplicates or siblings, and a shared POOL of OLDER candidate documents (C1, C2, …). Assign each NEWER document to the ONE older candidate that is its PREVIOUS version (the same document, before edits), or "none" if it is genuinely new. HARD CONSTRAINT: each older candidate is the previous version of AT MOST ONE newer document — never assign the same C-id to two newer documents. Content is EXPECTED to change between versions — values, wording, even a rename are normal edits, NOT evidence of a different document. Candidates may be NEAR-IDENTICAL (same title and body) and are told apart ONLY by their scope + position: the top-level scope (Governance, Support, Stability, Protocol, Accessibility, Agent), the owning process/element ("under:"), the breadcrumb ("path:"), and the documents immediately before/after ("position: … ‹THIS› …"). Match a newer document to the candidate whose scope AND owning process AND position line up; for repeated boilerplate (identical bodies like "Required Primitive Inputs") the "under:" owning process is decisive. Each document also shows "order N" — its position in the document (newer docs and older candidates are each listed in that order). When bodies AND scope are indistinguishable, preserve order: the reformat kept documents in sequence, so the k-th newer sibling is almost always the k-th older occurrence — assign monotonically (lower-order newer → lower-order older) unless scope/under says otherwise. Reason across the whole set jointly: if two newer docs both fit one candidate, give it to the better fit and place the other elsewhere or "none". You may also be given THE CHANGE (PR + forum edit-list) that produced these documents. Reply ONLY JSON: {"assignments":[{"subject":"S<n>","choice":"C<n>"|"none","why":"<short>"}]}. Include EVERY newer document exactly once.';

export interface ClusterSubject {
  key: string; // the caller's stable id for this newer doc (a case key) — echoed back in the result
  title: string;
  content: string;
  order?: number; // document order of this newer doc (deterministic position signal for identical stubs)
  context?: NodeContext | null;
}
export interface ClusterAssignment {
  subjectKey: string;
  chosenKey: string; // an older candidate key, or "none"
  why: string;
}
export interface ClusterResult {
  assignments: ClusterAssignment[];
  conflicts: number; // candidates the model assigned to >1 subject (kept the first, rest → "none")
  missing: number; // subjects the model failed to return (defaulted to "none")
}

export async function proposeClusterAssignment(
  subjects: ClusterSubject[],
  candidates: ProposeCandidate[],
  opts: { model?: string; change?: ChangeContext | null; clip?: number } = {},
): Promise<ClusterResult> {
  const max = opts.clip ?? 700; // shorter per-doc clip — a cluster stacks many docs into one prompt
  const homeNote = (c: ProposeCandidate): string =>
    c.soleHome ? '\n  note: no other document lists this candidate — if unused it is treated as DELETED.' : '';
  const ch = opts.change;
  const changeBlock = ch && (ch.title || ch.summary)
    ? `THE CHANGE that produced these documents${ch.pr ? ` (PR #${ch.pr})` : ""}: ${ch.title || ""}` +
      `${ch.summary ? `\n${clip(ch.summary, 1200)}` : ""}\n\n`
    : "";
  const sid = (i: number) => `S${i + 1}`;
  const cid = (i: number) => `C${i + 1}`;
  // deterministic order tag: subjects carry an explicit `order`; older candidates encode their
  // document position as the `#N` occurrence suffix on the key — surface both so the model can
  // align indistinguishable stubs monotonically (see CLUSTER_SYSTEM).
  const occOf = (key: string): string => { const s = key.split("#")[1]; return s ? ` (order ${s})` : ""; };
  const user =
    changeBlock +
    `NEWER documents (assign EACH to one older candidate, or "none"):\n` +
    subjects.map((s, i) => `${sid(i)}${s.order != null ? ` (order ${s.order})` : ""}: [${s.title}] ${clip(s.content, max)}${posLine(s.context)}`).join("\n\n") +
    `\n\nOLDER candidate pool (each usable AT MOST once):\n` +
    candidates.map((c, i) => `${cid(i)}${occOf(c.key)}: [${c.title}] ${clip(c.content, max)}${posLine(c.context)}${homeNote(c)}`).join("\n\n");

  const response = await getClient().chat.completions.create(
    {
      model: opts.model ?? getModel(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: CLUSTER_SYSTEM }, { role: "user", content: user }],
    },
    { timeout: 60000, maxRetries: 1 },
  );

  const parsed = looseJsonParse(response.choices[0]?.message?.content ?? "{}");
  const rows: { subject?: string; choice?: string }[] = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const bySubjectId = new Map<string, { choice?: string; why?: string }>();
  for (const r of rows) if (typeof r.subject === "string") bySubjectId.set(r.subject.trim().toUpperCase(), r as { choice?: string; why?: string });

  const used = new Set<string>();
  let conflicts = 0, missing = 0;
  const assignments: ClusterAssignment[] = subjects.map((s, i) => {
    const row = bySubjectId.get(sid(i));
    if (!row) { missing++; return { subjectKey: s.key, chosenKey: "none", why: "(model omitted this subject)" }; }
    const choice = String(row.choice ?? "none").trim();
    const why = typeof (row as { why?: string }).why === "string" ? (row as { why: string }).why : "";
    if (/^none$/i.test(choice)) return { subjectKey: s.key, chosenKey: "none", why };
    const m = /^C(\d+)$/i.exec(choice);
    const cand = m ? candidates[Number(m[1]) - 1] : undefined;
    if (!cand) return { subjectKey: s.key, chosenKey: "none", why }; // hallucinated id → none
    if (used.has(cand.key)) { conflicts++; return { subjectKey: s.key, chosenKey: "none", why: `(conflict: ${cand.key} already used) ${why}` }; }
    used.add(cand.key);
    return { subjectKey: s.key, chosenKey: cand.key, why };
  });
  return { assignments, conflicts, missing };
}

// --- dev-only save: persist the human's curation choices to the COMMITTED file ---------
// Curation is a local activity (the served page is read-only), so this writes the in-repo
// public/history-decisions.json that `pnpm htmlhist:apply` bakes and the page re-loads on
// any checkout. Pure write helper, separated for unit-testing; validates the shape and
// targets a FIXED filename under `dir`, so a client can never steer the write path.

export function writeDecisionsFile(dir: string, body: unknown): number {
  const file = body as { kind?: string; decisions?: unknown[] };
  if (file?.kind !== "html-era-history-decisions" || !Array.isArray(file.decisions)) {
    throw new Error("not a decisions file (expected kind 'html-era-history-decisions' + a decisions array)");
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DECISIONS_FILE), JSON.stringify(file, null, 2));
  return file.decisions.length;
}

export async function handleCurateSave(req: Request): Promise<Response> {
  if (!config.curationSaveEnabled) return Response.json({ error: "save is dev-only" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const count = writeDecisionsFile(config.publicDir, body);
    return Response.json({ ok: true, count, path: `public/${DECISIONS_FILE}` });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message || error) }, { status: 400 });
  }
}

export async function handleCuratePropose(req: Request): Promise<Response> {
  if (!config.openrouterApiKey) return Response.json({ error: "no OpenRouter key configured" }, { status: 404 });

  type Body = { subject?: ProposeSubject; candidates?: ProposeCandidate[] };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { subject, candidates } = body;
  if (!subject || !Array.isArray(candidates) || !candidates.length) {
    return Response.json({ error: "missing subject/candidates" }, { status: 400 });
  }

  try {
    return Response.json(await proposePredecessor(subject, candidates));
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message || error) }, { status: 502 });
  }
}
