// Isolated JSON LLM for MSC views. Sees only the curated view + a clipped
// user question — never atlas tools, never conversation history, never forum HTML.

import type { JsonCall } from "../chat/llm.ts";
import { callWithTimeout } from "../chat/llm.ts";
import { config } from "../config.ts";
import { MSC_REQUIRED_DISCLAIMER } from "./envelope.ts";
import { briefFromView } from "./msc-views.ts";

const QUESTION_CAP = 500;
const NOTES_CAP = 500;
const FIGURES_CAP = 12;

const SYSTEM = [
  "You summarise Monthly Settlement Cycle figures for another assistant.",
  "The JSON payload is NOT the Sky Atlas. It is Soter Labs workbook data (OEA calculations, not the on-chain GovOps spell) and optional Sky Forum metadata (title/url only).",
  "Copy figures from the payload. Do not invent totals. Do not add cost of funds to To Sky. Do not treat Profit to Grove as supply kept.",
  "Do not mention Atlas documents or invent UUIDs. Do not quote HTML. Do not output chain-of-thought.",
  "Respond with STRICT JSON only.",
].join(" ");

export function clipQuestion(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, QUESTION_CAP);
}

export interface MscBrief {
  source_class: "external";
  not_atlas: true;
  required_disclaimer: string;
  figures: { name: string; value: number; unit: string }[];
  forum: unknown;
  workbook_url: unknown;
  notes: string;
  subagent: "ok" | "skipped" | "failed";
  sources: unknown;
}

function asBrief(raw: unknown, fallback: Record<string, unknown>): MscBrief {
  const fb = fallback as unknown as MscBrief;
  if (!raw || typeof raw !== "object") return { ...fb, subagent: "failed" };
  const o = raw as Record<string, unknown>;
  const figuresIn = Array.isArray(o.figures) ? o.figures : fb.figures;
  const figures: MscBrief["figures"] = [];
  for (const f of figuresIn.slice(0, FIGURES_CAP)) {
    if (!f || typeof f !== "object") continue;
    const row = f as Record<string, unknown>;
    if (typeof row.name !== "string" || typeof row.value !== "number") continue;
    figures.push({ name: row.name.slice(0, 80), value: row.value, unit: typeof row.unit === "string" ? row.unit : "USD" });
  }
  const notes = typeof o.notes === "string" ? o.notes.replace(/\s+/g, " ").trim().slice(0, NOTES_CAP) : "";
  return {
    source_class: "external",
    not_atlas: true,
    required_disclaimer: MSC_REQUIRED_DISCLAIMER,
    figures: figures.length > 0 ? figures : fb.figures,
    forum: fb.forum,
    workbook_url: fb.workbook_url,
    notes,
    subagent: "ok",
    sources: fb.sources,
  };
}

export async function runMscSubagent(opts: {
  question: string;
  view: Record<string, unknown>;
  jsonCall?: JsonCall;
  signal?: AbortSignal;
}): Promise<MscBrief> {
  const fallback = briefFromView(opts.view) as unknown as MscBrief;
  const model = config.chatExternalSubagentModel || (opts.jsonCall ? "msc-subagent" : "");
  if (!opts.jsonCall || !model) return { ...fallback, subagent: "skipped" };
  try {
    const res = await callWithTimeout(
      opts.jsonCall,
      {
        model,
        maxTokens: 700,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              question: clipQuestion(opts.question),
              view: opts.view,
              required_disclaimer: MSC_REQUIRED_DISCLAIMER,
              output_shape: {
                figures: [{ name: "To Sky", value: 0, unit: "USD" }],
                notes: "≤500 chars answering the question from the view only",
              },
            }),
          },
        ],
      },
      config.chatExternalSubagentTimeoutMs,
      opts.signal,
    );
    const parsed = JSON.parse(res.text) as unknown;
    return asBrief(parsed, fallback as unknown as Record<string, unknown>);
  } catch {
    return { ...fallback, subagent: "failed" };
  }
}
