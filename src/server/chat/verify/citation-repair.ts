// Deterministic citation repair — models (especially small ones) cannot
// reliably transcribe 36-char UUIDs out of long tool results, so the
// orchestrator stops trusting them with link targets: every /atlas/ link is
// validated in code; invalid targets are re-resolved from what was actually
// retrieved this turn (near-miss uuid, doc_no href, truncated uuid, title
// match), and anything unrepairable is de-linkified so a dead link can never
// ship. The decision function (createLinkJudge) is shared with the streaming
// link gate (stream-link-gate.ts), which applies the same repairs to token
// events BEFORE they reach the client; repairCitations then runs post-answer
// as the authority — before the deterministic checks, which validate the
// repaired answer; stripped links are folded back in as hard failures by the
// orchestrator.
import { DOC_NO_CORE, UUID_RE } from "../../../lib/patterns.ts";
import { normalizeForMatch } from "./verify-checks.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

// Link text often leads with a doc_no ("A.1.6 - Title") — a real one
// identifies the doc directly; either way it's stripped before title
// matching. Built from the shared DOC_NO_CORE (src/lib/patterns.ts).
const DOC_NO_LEAD = new RegExp(String.raw`^(` + DOC_NO_CORE + String.raw`)(?:\s*[-–—:]\s*|\s*$)`);

export interface CitationRepair {
  content: string;
  repaired: { title: string; from: string; to: string }[];
  stripped: { title: string; target: string }[];
}

const hex32 = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, "");

// Unique near-miss: a full-length uuid whose 32 hex chars differ from exactly
// one candidate in ≤6 positions. Two random uuids differ in ~30 positions, so
// a ≤6-char garble identifies its source unambiguously.
function nearMiss(target: string, candidates: string[]): string | null {
  const t = hex32(target);
  if (t.length !== 32) return null;
  let best: string | null = null;
  let bestD = 7;
  let tied = false;
  for (const c of candidates) {
    const h = hex32(c);
    if (h.length !== 32) continue;
    let d = 0;
    for (let i = 0; i < 32 && d <= 6; i++) if (h[i] !== t[i]) d++;
    if (d < bestD) [best, bestD, tied] = [c, d, false];
    else if (d === bestD && d < 7 && c !== best) tied = true;
  }
  return tied ? null : best;
}

// norm(title) → uuids, ambiguity preserved as list length.
function titleIndex(docs: Iterable<{ id: string; title: string }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const d of docs) {
    const key = normalizeForMatch(d.title);
    if (!key) continue;
    const arr = map.get(key);
    if (arr) arr.push(d.id);
    else map.set(key, [d.id]);
  }
  return map;
}

// The fate of one markdown link, decided against the atlas + this turn's
// evidence. `from`/`target` are normalized the way the repair records expect:
// for /atlas/ links the uuid part alone, for pseudo-citations the whole href.
export type LinkVerdict =
  | { action: "keep" }
  | { action: "repair"; from: string; to: string }
  | { action: "strip"; target: string };

export type LinkJudge = (title: string, target: string) => LinkVerdict;

// ONE decision function shared by the post-answer repair pass and the
// streaming link gate, so what streams and what ships at done cannot disagree.
export function createLinkJudge(evidenceTexts: string[], ix: Indexes): LinkJudge {
  // Docs that actually appeared in this turn's tool results — the only pool a
  // garbled uuid can plausibly have come from, and the first place a title
  // match is trusted.
  // UUID_RE is anchored (^…$) — slice the anchors off for a global scan.
  const evidenceUuids = [...new Set((evidenceTexts.join("\n").match(new RegExp(UUID_RE.source.slice(1, -1), "gi")) ?? []).map((u) => u.toLowerCase()))]
    .filter((u) => ix.docMap.has(u));
  const evidenceTitles = titleIndex(evidenceUuids.map((u) => ix.docMap.get(u)!));
  let fullTitles: Map<string, string[]> | null = null; // whole-atlas fallback, built lazily

  // Resolve a doc from the link TEXT alone: a leading real doc_no wins, then
  // a title match — unique among retrieved docs, else unique across the atlas.
  const resolveByText = (title: string): string | null => {
    const claimed = title.match(DOC_NO_LEAD)?.[1];
    const byNo = claimed ? ix.byDocNo.get(claimed) : undefined;
    if (byNo) return byNo.id;
    const key = normalizeForMatch(title.replace(DOC_NO_LEAD, ""));
    if (!key) return null;
    const ev = evidenceTitles.get(key) ?? [];
    if (new Set(ev).size === 1) return ev[0];
    fullTitles ??= titleIndex(ix.docMap.values());
    const all = fullTitles.get(key) ?? [];
    return all.length === 1 ? all[0] : null;
  };

  const resolve = (title: string, target: string): string | null => {
    const t = target.toLowerCase();
    if (ix.docMap.has(t)) return t; // already valid
    const byNo = ix.byDocNo.get(target); // doc_no used as href
    if (byNo) return byNo.id;
    const near = nearMiss(t, evidenceUuids);
    if (near) return near;
    // Truncated uuid: unique hex prefix (≥8 chars), evidence docs first.
    const hex = hex32(t);
    if (/^[0-9a-f-]+$/.test(t) && hex.length >= 8 && hex.length < 32) {
      const pool = evidenceUuids.filter((u) => hex32(u).startsWith(hex));
      const hits = pool.length > 0 ? pool : [...ix.docMap.keys()].filter((u) => hex32(u).startsWith(hex));
      if (hits.length === 1) return hits[0];
    }
    return resolveByText(title);
  };

  return (title, target) => {
    if (target.startsWith("/atlas/")) {
      const t = target.slice("/atlas/".length);
      if (!t) return { action: "keep" };
      const to = resolve(title, t);
      if (to === t.toLowerCase()) return { action: "keep" }; // valid as written
      if (to) return { action: "repair", from: t, to };
      return { action: "strip", target: t }; // de-linkify — never ship a dead link
    }
    // A scheme, another root-relative route, or an anchor: a real link, not ours.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/") || target.startsWith("#")) return { action: "keep" };
    // Pseudo-citation — models emit tool names or topic slugs as hrefs
    // ("[Doc Structure](atlas_describe)"). Promote via the title, else strip.
    const to = resolveByText(title);
    return to ? { action: "repair", from: target, to } : { action: "strip", target };
  };
}

// A markdown reference-link definition `[label]: /atlas/<uuid>` (optional title).
// Only /atlas/ destinations are our citations; anything else is left untouched.
const DEF_LINE_RE = /^([ \t]{0,3}\[)([^[\]\n]{1,120})(\]:[ \t]*)(<[^>\s]*>|\S+)([ \t]*(?:"[^"]*"|'[^']*'|\([^)\s]*\))?[ \t]*)$/;

// Slugs are the model's handle for a doc; un-slugified they feed the judge's
// text-resolution ladder exactly as inline link text does (`spark-rate` →
// `spark rate`). Underscores and repeated dashes collapse the same way.
export const unslugifyLabel = (label: string): string => label.replace(/[-_]+/g, " ").trim();

// Repair a reference-style DEFINITION BLOCK — the citation table, not each use.
// One garbled UUID in a definition is fixed once here and every `[text][label]`
// that points at it is corrected wholesale (the streaming gate releases this
// repaired block before any prose). An unrepairable definition is DROPPED, never
// emitted with a dead target; its uses then fall to the undefined-label path.
export function repairDefinitionBlock(block: string, judge: LinkJudge): CitationRepair {
  const repaired: CitationRepair["repaired"] = [];
  const stripped: CitationRepair["stripped"] = [];
  const kept = block.split("\n").map((line): string | null => {
    const m = DEF_LINE_RE.exec(line);
    if (!m) return line; // not a definition line — pass through verbatim
    const dest = m[4].replace(/^<|>$/g, "");
    const v = judge(unslugifyLabel(m[2]), dest);
    if (v.action === "keep") return line;
    if (v.action === "repair") {
      repaired.push({ title: m[2], from: v.from, to: v.to });
      return `${m[1]}${m[2]}${m[3]}/atlas/${v.to}${m[5]}`;
    }
    stripped.push({ title: m[2], target: v.target });
    return null;
  });
  return { content: kept.filter((l): l is string => l !== null).join("\n"), repaired, stripped };
}

// Resolve a bare reference LABEL (used but never defined) to a doc UUID via the
// same text-resolution ladder inline repair uses: a non-atlas placeholder target
// drives the judge to `resolveByText`, so a label unique among this turn's
// retrieved docs (else unique across the atlas) yields its UUID. Powers the
// undefined-label degradation — synthesize the definition when it resolves.
export function resolveLabelToUuid(label: string, judge: LinkJudge): string | null {
  const v = judge(unslugifyLabel(label), "unresolved-reference-label");
  return v.action === "repair" ? v.to : null;
}

export function repairCitations(answer: string, evidenceTexts: string[], ix: Indexes): CitationRepair {
  const judge = createLinkJudge(evidenceTexts, ix);
  const repaired: CitationRepair["repaired"] = [];
  const stripped: CitationRepair["stripped"] = [];
  // One generic scan (any whitespace-free-href link) replaces the old two-pass
  // atlas-then-pseudo rewrite; the judge dispatches per link.
  const content = answer.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, title: string, target: string) => {
    const v = judge(title, target);
    if (v.action === "keep") return m;
    if (v.action === "repair") {
      repaired.push({ title, from: v.from, to: v.to });
      return `[${title}](/atlas/${v.to})`;
    }
    stripped.push({ title, target: v.target });
    return title;
  });
  return { content, repaired, stripped };
}
