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
  "You thread an atlas document's history. Given a NEWER document and several OLDER candidate documents, pick which OLDER candidate is the PREVIOUS version of the NEWER one (the same document, before edits), or \"none\" if the newer document is genuinely new. Content is EXPECTED to change between versions — values, wording, even a rename are normal edits, NOT evidence of a different document. Judge by title + subject/role + prose. Reply ONLY JSON: {\"chosenKey\":\"<one of the candidate keys>\"|\"none\",\"why\":\"<short>\"}.";

const clip = (text: string, max = 1200) => (text || "").slice(0, max);

export interface ProposeSubject {
  title: string;
  content: string;
}
export interface ProposeCandidate {
  key: string;
  title: string;
  content: string;
}
export interface ProposeResult {
  chosenKey: string;
  why: string;
}

// The LLM proposal core, shared by the HTTP endpoint (human-in-the-loop UI) and the
// offline batch auto-curator (scripts/aux/auto-curate-html-history.mjs) so the prompt
// lives in exactly one place. Returns the model's chosen candidate key (constrained to
// the supplied keys, else "none") + a short rationale. The model only PROPOSES — a
// human confirms in the UI, or the batch script only locks a case when the LLM agrees
// with an already-confident matcher pick — so this never touches build determinism.
export async function proposePredecessor(
  subject: ProposeSubject,
  candidates: ProposeCandidate[],
  opts: { model?: string } = {},
): Promise<ProposeResult> {
  const user =
    `NEWER document:\n[${subject.title}] ${clip(subject.content)}\n\n` +
    `OLDER candidates (pick the one that is its previous version, or "none"):\n` +
    candidates.map((c) => `key=${c.key}\n[${c.title}] ${clip(c.content)}`).join("\n\n");

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
  const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  const chosenKey = parsed.chosenKey === "none" || candidates.some((c) => c.key === parsed.chosenKey) ? parsed.chosenKey : "none";
  return { chosenKey: chosenKey ?? "none", why: typeof parsed.why === "string" ? parsed.why : "" };
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
