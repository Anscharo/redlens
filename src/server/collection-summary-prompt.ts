// Pure half of the collection group name: what the model is shown, and how its
// answer is read. The model never sees document bodies, only titles and how the
// docs spread over the atlas's top-level scopes.
import type OpenAI from "openai";
import { createHash } from "node:crypto";
import type { AtlasNode } from "../types.ts";
import { ancestorChain, type Indexes } from "./retrieval/indexes.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface CollectionSummary {
  label: string;
  summary: string;
}

export interface SummaryInput {
  total: number;
  /** Top-level scopes the docs sit under, biggest first. */
  scopes: { title: string; count: number }[];
  /** Distinct titles with how often each repeats, most repeated first. */
  titles: { title: string; count: number }[];
}

// Bump when the prompt changes, so cached summaries are rewritten.
const PROMPT_VERSION = 1;
const MAX_TITLES = 200;
const MAX_SCOPES = 6;
const MAX_LABEL_WORDS = 5;
const MAX_SUMMARY_CHARS = 200;

export function idsHash(ids: readonly string[]): string {
  return createHash("sha256").update(`v${PROMPT_VERSION}\n${[...ids].sort().join("\n")}`).digest("hex");
}

function tally<T>(items: T[], key: (item: T) => string): { title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count);
}

function topScope(ix: Indexes, node: AtlasNode): string {
  const chain = ancestorChain(ix, node.id);
  return (chain.length ? chain[chain.length - 1].title : node.title).trim();
}

export function summaryInput(ix: Indexes, ids: readonly string[]): SummaryInput {
  const nodes = ids.map((id) => ix.docMap.get(id)).filter((n): n is AtlasNode => !!n);
  const titles = tally(nodes, (n) => n.title.trim());
  return {
    total: nodes.length,
    scopes: tally(nodes, (n) => topScope(ix, n)).slice(0, MAX_SCOPES),
    titles: titles.slice(0, MAX_TITLES),
  };
}

const SUMMARY_SYSTEM = [
  "You name a group of documents from the Sky Atlas, a governance document set.",
  "You see the group's document titles (a number after × means that title repeats) and which top-level scopes the documents sit under.",
  "Say what the group is about, using only the titles. Describe the topic; do not state what any rule requires.",
  `label: ${MAX_LABEL_WORDS} words or fewer, specific, no trailing punctuation.`,
  `summary: one plain sentence under ${MAX_SUMMARY_CHARS} characters.`,
  'Respond with STRICT JSON only: {"label":"…","summary":"…"}',
].join("\n");

const line = (e: { title: string; count: number }) => (e.count > 1 ? `${e.title} ×${e.count}` : e.title);

export function buildSummaryPrompt(input: SummaryInput): Msg[] {
  const shown = input.titles.reduce((n, t) => n + t.count, 0);
  const more = input.total - shown;
  const user = [
    `${input.total} documents.`,
    `Scopes: ${input.scopes.map((s) => `${s.title} (${s.count})`).join("; ")}`,
    "Titles:",
    ...input.titles.map(line),
    ...(more > 0 ? [`…and ${more} more documents with other titles`] : []),
  ].join("\n");
  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: user },
  ];
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^["'‘’“”]+|["'‘’“”]+$/g, "").trim();

// Tolerant: cheap providers sometimes wrap the JSON in fences or skip it.
// Anything without both fields is null, so nothing half-formed is cached.
export function parseSummary(raw: string): CollectionSummary | null {
  let parsed: { label?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/```(?:json)?/g, "").trim());
  } catch {
    return null;
  }
  if (typeof parsed?.label !== "string" || typeof parsed.summary !== "string") return null;
  const label = tidy(parsed.label).replace(/\.+$/, "").split(" ").slice(0, MAX_LABEL_WORDS).join(" ");
  const summary = tidy(parsed.summary).slice(0, MAX_SUMMARY_CHARS).trim();
  return label && summary ? { label, summary } : null;
}
