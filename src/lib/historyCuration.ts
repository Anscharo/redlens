// Client logic for the HTML-era history CURATION tool (plan §10.4). Loads the
// offline case file (public/history-curation.json, built by
// scripts/aux/build-history-curation.mjs), persists the human's picks in
// localStorage, asks the server LLM to pre-propose a predecessor, and exports a
// content-addressed decisions.json the build can apply. Pure-ish: only loadCuration
// and proposePredecessor touch the network.

export interface CurationNode {
  sha: string;
  title: string;
  doc_no: string | null;
  type: string;
  content: string;
  prev?: string[]; // nearby-entry keys (preceding docs in the same commit, nearest-first)
  next?: string[]; // nearby-entry keys (following docs in the same commit, nearest-first)
}
export interface CurationCandidate {
  key: string;
  score: number;
}
export interface CurationCase {
  key: string; // content-address of the subject (newer) doc — the decision's stable id
  kind: string; // seed-close | tier-2.5 | tier-2.7 | tier-3 | ambiguous
  reason?: string;
  newerSha: string;
  olderSha: string;
  subjectKey: string;
  autoKey: string | null; // what the matcher chose (null for flagged-ambiguous)
  candidates: CurationCandidate[];
}
export interface CurationData {
  meta: Record<string, unknown>;
  commits: { sha: string; date: string | null; pr: number | null }[];
  nodes: Record<string, CurationNode>;
  cases: CurationCase[];
}

// A pick is the chosen older-doc key, the sentinel "none" (created here / no
// predecessor), or undefined (not yet decided).
export type Pick = string | "none";

let cache: Promise<CurationData> | null = null;
export function loadCuration(): Promise<CurationData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}history-curation.json`).then((r) => {
      if (!r.ok) throw new Error("history-curation.json not found — run `bun scripts/aux/build-history-curation.mjs`");
      return r.json();
    });
  }
  return cache;
}

// --- decisions persistence (localStorage, survives reloads) ----------------------
const STORE_KEY = "history-curation-decisions-v1";
export function loadPicks(): Record<string, Pick> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}
export function savePicks(picks: Record<string, Pick>): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(picks));
}

// The exported file the apply step consumes. Keyed by content-address so a recorded
// decision survives an atlas renumber (we never key on doc_no).
export function buildDecisionsFile(data: CurationData, picks: Record<string, Pick>) {
  const decided = data.cases.filter((c) => picks[c.key] !== undefined);
  return {
    kind: "html-era-history-decisions",
    builtFrom: { migrationSha: data.meta.migrationSha, lastHtmlSha: data.meta.lastHtmlSha },
    count: decided.length,
    decisions: decided.map((c) => ({
      caseKey: c.key,
      kind: c.kind,
      subjectKey: c.subjectKey,
      newerSha: c.newerSha,
      olderSha: c.olderSha,
      chosenKey: picks[c.key], // older-doc content-address, or "none"
      agreedWithAuto: picks[c.key] === c.autoKey,
    })),
  };
}

export function downloadDecisions(data: CurationData, picks: Record<string, Pick>): void {
  const blob = new Blob([JSON.stringify(buildDecisionsFile(data, picks), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "history-decisions.json";
  a.click();
  URL.revokeObjectURL(url);
}

// --- LLM pre-proposal (server endpoint /api/history-curate/propose) --------------
export interface Proposal {
  chosenKey: string | "none";
  why: string;
}
export async function proposePredecessor(subject: CurationNode, candidates: { key: string; node: CurationNode }[]): Promise<Proposal> {
  const r = await fetch("/api/history-curate/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: { title: subject.title, content: subject.content },
      candidates: candidates.map((c) => ({ key: c.key, title: c.node.title, content: c.node.content })),
    }),
  });
  // The Bun server doesn't hot-reload routes: if it was started before this endpoint
  // existed, the request falls through to the SPA fallback and returns HTML. Detect
  // that and say so, instead of an opaque JSON-parse error.
  const contentType = r.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("propose endpoint not found — restart the dev server (Bun routes don't hot-reload)");
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `propose failed: ${r.status}`);
  }
  return r.json();
}
