// Parses one sky-ecosystem/executive-votes markdown file. Pure: no I/O.

import { ATLAS_FAMILIES, extractLinks, readFrontmatter } from "./markdown.ts";
import type { Executive, ExecutiveSection, VoteLink } from "./types.ts";

const FILENAME_DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TEMPLATE_PREFIX_RE = /^Template\s*-\s*\[Executive Vote\]\s*/i;
const OOS_TITLE_RE = /\bout[- ]of[- ]schedule\b/i;
// The executive template's address placeholder. A drafted executive is
// committed before its spell is deployed and keeps this value until then.
const PENDING_ADDRESS = "$spell_address";

/** The YYYY-MM-DD in a vote file's name. Throws when there is none: every date key depends on it. */
export function filenameDate(file: string): string {
  const base = file.split("/").pop() ?? file;
  const m = FILENAME_DATE_RE.exec(base);
  if (!m) throw new Error(`votes: ${file} has no YYYY-MM-DD in its filename`);
  return m[1];
}

export function parseExecutive(file: string, md: string): Executive {
  const { fields, body } = readFrontmatter(md);
  const raw = fields.address ?? "";
  if (raw !== PENDING_ADDRESS && !ADDRESS_RE.test(raw)) {
    throw new Error(`votes: ${file} has neither a spell address nor the template placeholder (got "${raw}")`);
  }
  const title = (fields.title ?? "").replace(TEMPLATE_PREFIX_RE, "").trim();
  const base = file.split("/").pop() ?? file;
  return {
    file,
    date: filenameDate(file),
    frontmatterDate: FILENAME_DATE_RE.exec(fields.date ?? "")?.[1] ?? null,
    outOfSchedule: /^oos-/i.test(base) || OOS_TITLE_RE.test(title),
    title,
    summary: fields.summary ?? "",
    address: raw === PENDING_ADDRESS ? null : raw,
    sections: parseSections(body),
    portal: null,
  };
}

/** The `### <action>` blocks under `## Proposal Details`, in document order. */
export function parseSections(body: string): ExecutiveSection[] {
  const details = proposalDetails(body);
  if (details === null) return [];
  const sections: ExecutiveSection[] = [];
  for (const block of details.split(/^### /m).slice(1)) {
    const nl = block.indexOf("\n");
    const heading = (nl === -1 ? block : block.slice(0, nl)).trim();
    const text = nl === -1 ? "" : block.slice(nl + 1);
    sections.push({
      heading,
      authorization: labelledLinks(text, "Authorization"),
      proposal: labelledLinks(text, "Proposal"),
      // The heading counts: an action titled with an atlas link cites that document.
      atlasRefs: extractLinks(`${heading}\n${text}`).filter((l) => ATLAS_FAMILIES.has(l.family)),
    });
  }
  return sections;
}

function proposalDetails(body: string): string | null {
  const start = /^## Proposal Details\s*$/m.exec(body);
  if (!start) return null;
  const rest = body.slice(start.index + start[0].length);
  const end = /^## /m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

// Links on bullet lines labelled `**<label>**:`, at any nesting depth — a
// Prime Agent Proxy Spells section carries one labelled bullet per Prime.
function labelledLinks(text: string, label: string): VoteLink[] {
  const re = new RegExp(`^\\s*[-*]\\s+\\*\\*${label}\\*\\*:?(.*)$`, "gm");
  const out: VoteLink[] = [];
  for (const m of text.matchAll(re)) out.push(...extractLinks(m[1]));
  return out;
}
