// Client logic for the HTML-era history CURATION tool (plan §10.4). Loads three static,
// offline-built JSONs — the case file (public/history-curation.json), the auto-resolved
// baseline (history-auto-decisions.json), and the frontier hints (history-curation-
// proposals.json) — persists the human's picks in localStorage, and exports a content-
// addressed decisions.json the build can apply. No runtime LLM calls: the cheap + frontier
// opinions are pre-computed in the prepare phase, so the page is a pure static consumer.

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
  subjectOrder?: number; // the subject doc's position within its commit (document order)
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
      if (!r.ok) throw new Error("history-curation.json not found — run `pnpm htmlhist:curate`");
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
export function buildDecisionsFile(data: CurationData, picks: Record<string, Pick>, autoResolved?: Map<string, string>) {
  const decided = data.cases.filter((c) => picks[c.key] !== undefined);
  return {
    kind: "html-era-history-decisions",
    builtFrom: { migrationSha: data.meta.migrationSha, lastHtmlSha: data.meta.lastHtmlSha },
    count: decided.length,
    decisions: decided.map((c) => {
      const d = {
        caseKey: c.key,
        kind: c.kind,
        subjectKey: c.subjectKey,
        newerSha: c.newerSha,
        olderSha: c.olderSha,
        chosenKey: picks[c.key], // older-doc content-address, or "none"
        agreedWithAuto: picks[c.key] === c.autoKey,
      };
      // method = how this link was traced: an accepted auto-pick keeps its mechanism's
      // method (ai / deterministic); anything the human decided is "human". Drives the
      // per-change provenance badge in the history view (only ai/human are surfaced).
      if (!autoResolved) return d;
      return { ...d, method: autoResolved.has(c.key) ? methodOfMechanism(autoResolved.get(c.key)) : "human" };
    }),
  };
}

// Mechanism (a baseline decision's `auto`) → provenance method. LLM + frontier locks are
// "ai"; the deterministic passes are "deterministic". Mirrors the freeze-side
// mechanismToMethod (scripts/lib/auto-curate.mjs) so the page and the bake agree.
const methodOfMechanism = (via?: string): "deterministic" | "ai" =>
  via === "llm-90" || via === "llm-95" || via === "frontier" ? "ai" : "deterministic";

// --- committed human decisions (public/history-decisions.json) --------------------
// The human's saved choices, COMMITTED to git (written by the dev save endpoint below
// or by hand). Loaded so curation state persists across machines / checkouts, not just
// one browser's localStorage. Best-effort: absent → no committed layer yet.
export async function loadDecisions(): Promise<Record<string, Pick>> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}history-decisions.json`);
    if (!r.ok) return {};
    const file = await r.json();
    const out: Record<string, Pick> = {};
    for (const d of file.decisions || []) out[d.caseKey] = d.chosenKey;
    return out;
  } catch {
    return {};
  }
}

// Persist the human's choices to the committed file via the DEV-ONLY save endpoint, so the
// next `pnpm htmlhist:apply` bakes them and any checkout reloads them. Throws when the
// endpoint is disabled (prod) or unreachable — the caller falls back to the download export.
export async function saveDecisions(data: CurationData, picks: Record<string, Pick>, autoResolved?: Map<string, string>): Promise<number> {
  const file = buildDecisionsFile(data, picks, autoResolved);
  const r = await fetch("/api/history-curate/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(file),
  });
  // Bun doesn't hot-reload routes: a stale server falls through to the SPA HTML.
  if (!(r.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("save endpoint not found — restart the dev server (Bun routes don't hot-reload)");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `save failed: ${r.status}`);
  return body.count ?? file.count;
}

export function downloadDecisions(data: CurationData, picks: Record<string, Pick>, autoResolved?: Map<string, string>): void {
  const blob = new Blob([JSON.stringify(buildDecisionsFile(data, picks, autoResolved), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "history-decisions.json";
  a.click();
  URL.revokeObjectURL(url);
}

// --- auto-resolved baseline (offline, scripts/aux/auto-curate-html-history.mjs) ---
// Optional pre-filled decisions for the cases two independent signals already agree on
// (forward∩reverse, or LLM∩matcher ≥90%). Fetched best-effort: the file is gitignored
// and may not exist, in which case the human simply curates the whole queue. `auto`
// records which mechanism resolved each case (for the UI badge), never overriding a
// decision the human already made.
export interface AutoDecision {
  chosenKey: Pick;
  auto: string;
}
export async function loadAutoDecisions(): Promise<Record<string, AutoDecision>> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}history-auto-decisions.json`);
    if (!r.ok) return {};
    const file = await r.json();
    const out: Record<string, AutoDecision> = {};
    for (const d of file.decisions || []) out[d.caseKey] = { chosenKey: d.chosenKey, auto: d.auto || "auto" };
    return out;
  } catch {
    return {};
  }
}

// --- frontier hints (offline, pass 3 of the auto-curator) -------------------------
// A frontier-model suggested predecessor + reasoning for an UNCERTAIN residual case the
// model couldn't corroborate into a lock. Pre-computed in the prepare phase (along with
// the cheap-LLM pass), so the page makes NO LLM calls at runtime — it just displays these.
// This is what replaced the old live /api/history-curate/propose request, making the page
// a static, key-free consumer of three JSONs (queue + decisions + proposals).
export interface Proposal {
  chosenKey: string | "none";
  why: string;
}
export async function loadProposals(): Promise<Record<string, Proposal>> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}history-curation-proposals.json`);
    if (!r.ok) return {}; // gitignored / not generated → no suggestions, human curates unaided
    const file = await r.json();
    return (file.proposals as Record<string, Proposal>) || {};
  } catch {
    return {};
  }
}
