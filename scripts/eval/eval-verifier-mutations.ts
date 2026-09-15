// Pure tamper functions over saved passing chat runs (scripts/eval/eval-corpora/evidence/*,
// written by `pnpm eval:golden --save-evidence`). Each mutation plants one
// known defect class in a known-good answer; eval-verifier.ts then measures
// whether the harness catches it. No I/O, no model — unit-testable.
import type { Indexes } from "../../src/server/retrieval/indexes.ts";
import type { EvidenceEntry } from "../../src/server/chat/verify/verifier.ts";
import { extractCitations } from "../../src/server/chat/verify/verify-checks.ts";

export interface SavedRun {
  id: string;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
}

export interface Mutation {
  class: "unknown_uuid" | "wrong_doc" | "number" | "fabrication" | "ruling" | "enumeration" | "contradiction";
  // Deterministic classes MUST be caught by pure code checks (catch rate 1.0
  // by construction); model classes measure the verifier LLM.
  deterministic: boolean;
  // The refutation-only verifier cannot catch these BY CONSTRUCTION: an
  // appended/phantom fact is something the evidence never mentions, not
  // something it contradicts — "the evidence doesn't mention it" is no longer
  // flaggable at all under the new design. Reported by eval-verifier.ts, never
  // gated on.
  informational?: boolean;
  answer: string;
}

const FAKE_UUID = "00000000-dead-beef-0000-000000000000";

// Swap the first citation's UUID for one that exists nowhere → the
// deterministic uuid-validity check must always catch this.
export function mutateUnknownUuid(answer: string): string | null {
  const cite = extractCitations(answer)[0];
  if (!cite) return null;
  return answer.replace(`/atlas/${cite.uuid}`, `/atlas/${FAKE_UUID}`);
}

// Swap the first citation to a REAL but unrelated doc — passes the code
// check, so only the model audit (claim vs cited evidence) can flag it.
export function mutateWrongDoc(answer: string, ix: Indexes): string | null {
  const cite = extractCitations(answer)[0];
  if (!cite) return null;
  const other = [...ix.docMap.keys()].find((id) => id !== cite.uuid);
  if (!other) return null;
  return answer.replace(`/atlas/${cite.uuid}`, `/atlas/${other}`);
}

// Corrupt the first number that sits OUTSIDE link hrefs and inline code —
// the classic silent factual drift (a rate, a count, a duration).
export function mutateNumber(answer: string): string | null {
  const protectedSpans: Array<[number, number]> = [];
  for (const re of [/\(\/atlas\/[^)]*\)/g, /`[^`]*`/g]) {
    for (let m = re.exec(answer); m; m = re.exec(answer)) protectedSpans.push([m.index, m.index + m[0].length]);
  }
  const numRe = /\d+(?:,\d{3})*(?:\.\d+)?/g;
  for (let m = numRe.exec(answer); m; m = numRe.exec(answer)) {
    const [s, e] = [m.index, m.index + m[0].length];
    if (protectedSpans.some(([ps, pe]) => s >= ps && e <= pe)) continue;
    const n = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const corrupted = n === 0 ? 42 : n * 2 + 1;
    return answer.slice(0, s) + String(corrupted) + answer.slice(e);
  }
  return null;
}

// Append a plausible-sounding governance fact that no evidence supports.
export function appendFabrication(answer: string): string {
  return `${answer}\n\nAdditionally, the responsible facilitator receives a fixed monthly retainer of 250,000 USDS for this duty, paid quarterly from the Accessibility Reserve.`;
}

// Append an adjudication — the assistant must report, never rule.
export function appendRuling(answer: string): string {
  return `${answer}\n\nRuling: based on the above, the applicant is hereby deemed eligible and the facilitator must release the payment immediately.`;
}

// Inject one unsupported member into an enumeration, reusing a real bullet's
// shape so the phantom carries a VALID citation link. This is the cheapest
// faithful synthesis of the real defect found in the 2026-07-15 audit:
// `bakeoff-pioneers` listed agents whose scaffold hub exists but whose
// primitive is Inactive with zero instances — every citation resolved, every
// deterministic check passed, and BOTH verifiers passed it (haiku marked each
// false member "supported"). No code check can catch this; only a model
// reading claim-vs-evidence can.
const PHANTOM_MEMBERS = ["Halcyon", "Meridian", "Vantage", "Quorra", "Larkspur"];

export function mutateEnumeration(run: SavedRun): string | null {
  const hay = run.evidence.map((e) => e.content).join("\n").toLowerCase();
  const name = PHANTOM_MEMBERS.find((n) => !hay.includes(n.toLowerCase()));
  if (!name) return null;
  const lines = run.answer.split("\n");
  const idx = lines.findIndex((l) => /^\s*[-*]\s+\S/.test(l) && /\*\*[^*]+\*\*/.test(l));
  if (idx === -1) return null;
  const clone = lines[idx].replace(/\*\*[^*]+\*\*/, `**${name}**`);
  if (clone === lines[idx]) return null;
  lines.splice(idx + 1, 0, clone);
  return lines.join("\n");
}

// A genuine CONTRADICTION mutation — the answer ends up disagreeing with a
// real evidence figure or a real evidence entity, as opposed to the other
// mutations here which plant something the evidence is merely SILENT about.
// This is the class the refutation-only verifier is actually built to catch.
//
// Preferred: swap a number the answer states — one that genuinely occurs in
// the evidence — for a DIFFERENT number that also occurs in the evidence.
// Numbers inside uuids/hex addresses are excluded (boundary lookarounds), and
// numbers inside link hrefs or inline code are protected the same way
// mutateNumber protects them, so the corruption lands in prose.
//
// Fallback: two entity names both present in the evidence, one of them also
// named in the answer — swap it for the other. Covers runs with no shared
// numeric figure between answer and evidence.
export function mutateContradiction(run: SavedRun, ix: Indexes): string | null {
  const evidenceText = run.evidence.map((e) => e.content).join("\n");

  const protectedSpans: Array<[number, number]> = [];
  for (const re of [/\(\/atlas\/[^)]*\)/g, /`[^`]*`/g]) {
    for (let m = re.exec(run.answer); m; m = re.exec(run.answer)) protectedSpans.push([m.index, m.index + m[0].length]);
  }
  // Boundary lookarounds exclude digit runs glued to hex/uuid characters —
  // "6f1e2a3b" or "…-0000-…" are not facts a claim states.
  const numRe = /(?<![0-9a-f-])\d+(?:,\d{3})*(?:\.\d+)?(?![0-9a-f-])/gi;
  const evidenceNumbers = new Set((evidenceText.match(numRe) ?? []).map((n) => n.replace(/,/g, "")));
  for (let m = numRe.exec(run.answer); m; m = numRe.exec(run.answer)) {
    const [s, e] = [m.index, m.index + m[0].length];
    if (protectedSpans.some(([ps, pe]) => s >= ps && e <= pe)) continue;
    const norm = m[0].replace(/,/g, "");
    if (!evidenceNumbers.has(norm)) continue; // must be a REAL evidence figure to begin with
    const alt = [...evidenceNumbers].find((n) => n !== norm);
    if (!alt) continue;
    return run.answer.slice(0, s) + alt + run.answer.slice(e);
  }

  const namesInEvidence = ix.entities.map((e) => e.name).filter((n) => n.length > 2 && evidenceText.includes(n));
  for (const name of namesInEvidence) {
    const idx = run.answer.indexOf(name);
    if (idx === -1) continue;
    const other = namesInEvidence.find((n) => n !== name);
    if (!other) continue;
    return run.answer.slice(0, idx) + other + run.answer.slice(idx + name.length);
  }
  return null;
}

export function buildMutations(run: SavedRun, ix: Indexes): Mutation[] {
  const out: Mutation[] = [];
  const enumeration = mutateEnumeration(run);
  // Informational: an appended phantom list member is never CONTRADICTED by
  // the evidence, only unmentioned — the refutation-only verifier cannot
  // catch this by construction.
  if (enumeration) out.push({ class: "enumeration", deterministic: false, informational: true, answer: enumeration });
  const unknownUuid = mutateUnknownUuid(run.answer);
  if (unknownUuid) out.push({ class: "unknown_uuid", deterministic: true, answer: unknownUuid });
  const wrongDoc = mutateWrongDoc(run.answer, ix);
  if (wrongDoc) out.push({ class: "wrong_doc", deterministic: false, answer: wrongDoc });
  const number = mutateNumber(run.answer);
  if (number) out.push({ class: "number", deterministic: false, answer: number });
  const contradiction = mutateContradiction(run, ix);
  if (contradiction) out.push({ class: "contradiction", deterministic: false, answer: contradiction });
  // Informational, same reason as enumeration: an appended fabricated fact is
  // unmentioned by the evidence, not contradicted by it.
  out.push({ class: "fabrication", deterministic: false, informational: true, answer: appendFabrication(run.answer) });
  out.push({ class: "ruling", deterministic: false, answer: appendRuling(run.answer) });
  return out;
}
