/**
 * Renders the `pau:candidates` result as the Markdown the pau-triage skill
 * reads. Every row carries the atlas doc_no and UUID it came from, so a
 * reviewer can open the source without searching.
 */
import type { AtlasNode } from "../../src/types.ts";
import type { PauConflict, StaleMember } from "./pau-diff.ts";
import type { PauObservation } from "./pau-discover.ts";
import type { WiringReport } from "./pau-wiring.ts";

export interface CandidatesResult {
  atlasCommit: string;
  registryErrors: string[];
  observations: number;
  missing: PauObservation[];
  stale: StaleMember[];
  conflicts: PauConflict[];
  wiring: WiringReport | null;
}

type Docs = Record<string, AtlasNode>;
type Names = Map<string, string>;

const cite = (docs: Docs, uuid: string) => (docs[uuid] ? `${docs[uuid].doc_no} (${uuid})` : `(removed ${uuid})`);
const who = (names: Names, prime: string | null) => (prime ? names.get(prime) ?? prime : "shared");

// A cell may carry a "a | b" alternatives list (wiring details do); unescaped,
// the pipe would split the cell and garble the row.
const cell = (v: string) => v.replace(/\|/g, "\\|");

function table(head: string[], rows: string[][]): string[] {
  if (!rows.length) return ["_None._", ""];
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""];
}

function missingSection(r: CandidatesResult, docs: Docs, names: Names): string[] {
  const rows = r.missing.map((o) => [who(names, o.prime), o.chain, o.kind ?? "any", o.role, `\`${o.address}\``, o.title, cite(docs, o.doc)]);
  return ["## Missing from the registry", "", ...table(["Prime", "Chain", "Kind", "Role", "Address", "Atlas title", "Source"], rows)];
}

function staleSection(r: CandidatesResult, docs: Docs, names: Names): string[] {
  const rows = r.stale.map((s) => [who(names, s.prime), s.chain, s.role, `\`${s.address}\``, s.reason, cite(docs, s.doc)]);
  return ["## Stale registry provenance", "", ...table(["Prime", "Chain", "Role", "Address", "Why", "Source"], rows)];
}

function conflictSection(r: CandidatesResult, docs: Docs): string[] {
  const rows = r.conflicts.map((c) => [`\`${c.address}\``, c.reason, c.detail, c.docs.map((d) => cite(docs, d)).join("<br>")]);
  return ["## Atlas conflicts", "", ...table(["Address", "Kind", "Detail", "Sources"], rows)];
}

function wiringSection(w: WiringReport | null): string[] {
  if (!w) return ["## On-chain wiring", "", "_Not run. Pass `--rpc` to read the contracts._", ""];
  const failed = w.checks.filter((c) => !c.ok).map((c) => [c.deployment, c.check, c.detail]);
  const props = w.proposals.map((p) => [p.deployment, p.role, `\`${p.address}\``, p.note]);
  return [
    "## On-chain wiring",
    "",
    `${w.checks.length - failed.length} of ${w.checks.length} checks pass.`,
    "",
    "### Failed checks",
    "",
    ...table(["Deployment", "Check", "Detail"], failed),
    "### On-chain proposals",
    "",
    ...table(["Deployment", "Role", "Address", "From"], props),
  ];
}

export function renderCandidates(r: CandidatesResult, docs: Docs, names: Names): string {
  return [
    "# PAU registry candidates",
    "",
    `Atlas commit \`${r.atlasCommit}\`. ${r.observations} PAU addresses observed in the atlas; ${r.missing.length} missing, ${r.stale.length} stale, ${r.conflicts.length} conflicts.`,
    "",
    ...(r.registryErrors.length ? ["## Registry errors", "", ...r.registryErrors.map((e) => `- ${e}`), ""] : []),
    ...missingSection(r, docs, names),
    ...staleSection(r, docs, names),
    ...conflictSection(r, docs),
    ...wiringSection(r.wiring),
  ].join("\n");
}
