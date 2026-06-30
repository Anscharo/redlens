// POST /api/history-curate/propose — LLM pre-proposal for the HTML-era history
// curation tool (plan §10.4). Given a NEWER document and OLDER candidate documents,
// the model picks which candidate is the newer doc's PREVIOUS version (or "none").
// Local-only: gated on an OpenRouter key being present (the curation file it drives
// is never shipped to prod). The LLM only PROPOSES — a human confirms, and the
// recorded decision is what the build applies, so this never touches determinism.

import { getClient, getModel } from "./llm.ts";
import { config } from "./config.ts";

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
export async function proposePredecessor(subject: ProposeSubject, candidates: ProposeCandidate[]): Promise<ProposeResult> {
  const user =
    `NEWER document:\n[${subject.title}] ${clip(subject.content)}\n\n` +
    `OLDER candidates (pick the one that is its previous version, or "none"):\n` +
    candidates.map((c) => `key=${c.key}\n[${c.title}] ${clip(c.content)}`).join("\n\n");

  const response = await getClient().chat.completions.create(
    {
      model: getModel(),
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
