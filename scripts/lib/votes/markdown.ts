// Markdown primitives shared by the executive and poll parsers: a frontmatter
// reader, a link extractor, and the classifier that says where a link points.

import type { LinkFamily, VoteLink } from "./types.ts";

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TOP_LEVEL_FIELD_RE = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/;

/**
 * Reads the top-level scalar fields of a `---` frontmatter block. Nested
 * structures (a poll's `parameters`, `options`) are skipped: no field this
 * artifact needs is nested, and a lenient reader survives the hand-edited
 * YAML these repositories contain where a strict parser throws.
 */
export function readFrontmatter(md: string): Frontmatter {
  const m = FRONTMATTER_RE.exec(md);
  if (!m) return { fields: {}, body: md };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const f = TOP_LEVEL_FIELD_RE.exec(line);
    if (f && f[2] !== "") fields[f[1]] = unquote(f[2].trim());
  }
  return { fields, body: md.slice(m[0].length) };
}

function unquote(v: string): string {
  const q = v[0];
  return (q === '"' || q === "'") && v.endsWith(q) && v.length >= 2 ? v.slice(1, -1) : v;
}

/** Families that point at an atlas document, under either the current or the legacy host. */
export const ATLAS_FAMILIES: ReadonlySet<LinkFamily> = new Set(["atlas", "atlas-docno", "powerhouse"]);

// A URL may hold one level of balanced parentheses: legacy powerhouse paths
// carry titles like "Maximum_Debt_Ceiling_(line)".
const URL_BODY = String.raw`(?:[^()\s<>\]]|\([^()\s<>\]]*\))+`;
const MD_LINK_RE = new RegExp(String.raw`\[([^\]]*)\]\((https?:\/\/${URL_BODY})\)`, "g");
// Markdown links are blanked before this runs, so a bare URL only needs to
// start at a word boundary; one wrapped in a stray paren — "[text]((url))" —
// is still a link to the reader and is kept.
const BARE_URL_RE = new RegExp(String.raw`(?<!\w)https?:\/\/${URL_BODY}`, "g");

/** Every link in `text`, markdown links first, then bare URLs not already inside one. */
export function extractLinks(text: string): VoteLink[] {
  const out: VoteLink[] = [];
  for (const m of text.matchAll(MD_LINK_RE)) out.push(classifyLink(m[2], m[1]));
  const linked = text.replace(MD_LINK_RE, " ");
  for (const m of linked.matchAll(BARE_URL_RE)) out.push(classifyLink(m[0].replace(/[.,;]+$/, ""), ""));
  return out;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// A segment is digits with an optional short letter prefix: legacy powerhouse
// links number agent artifacts and Prime instances that way
// ("A.AG1.2.6.P15.2.1.2.3"), and the spec's scenario variations are ".var1".
// The match has to end at a delimiter — end of input, or the "_Title", "/",
// "|", "#", "%", "?", "-" or space that follows a doc_no in a URL. A segment
// shape this pattern does not know then yields no doc_no at all, instead of a
// truncated one that names an ancestor document.
const DOCNO_RE = /\b[A-Z]\.[A-Za-z]{0,3}\d+(?:\.[A-Za-z]{0,3}\d+)*(?=$|[_/|#%?\s-])/;
// Link text that names the poll id: "Governance Poll <id>", "Governance Poll ID <id>", "Poll #<id>".
const POLL_ID_IN_TEXT_RE = /\bpoll\s*(?:id\s*)?#?\s*(\d{2,6})\b/i;

interface Rule {
  family: LinkFamily;
  host: RegExp;
  detail?: (url: URL, text: string) => Partial<VoteLink>;
}

// Order matters: the first rule whose host matches decides the family, and an
// atlas link whose fragment is a doc_no rather than a uuid is reclassified below.
const RULES: Rule[] = [
  { family: "atlas", host: /(^|\.)sky-atlas\.io$/i, detail: atlasDetail },
  { family: "powerhouse", host: /(^|\.)sky-atlas\.powerhouse\.io$/i, detail: powerhouseDetail },
  { family: "poll", host: /^vote\.(sky\.money|makerdao\.com)$/i, detail: portalDetail },
  { family: "snapshot", host: /(^|\.)snapshot\.(box|org)$/i },
  { family: "forum", host: /^forum\.(sky\.money|skyeco\.com|makerdao\.com)$/i, detail: forumDetail },
];

export function classifyLink(url: string, text: string): VoteLink {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { family: "other", url, text };
  }
  const rule = RULES.find((r) => r.host.test(parsed.hostname));
  if (!rule) return { family: "other", url, text };
  const link: VoteLink = { family: rule.family, url, text, ...(rule.detail?.(parsed, text) ?? {}) };
  if (link.family === "atlas" && !link.uuid) link.family = link.docNo ? "atlas-docno" : "other";
  return link;
}

/**
 * decodeURIComponent, or the input unchanged when it holds a malformed escape
 * ("#A.1%2"): these links are hand-written, and one typo is not worth the run.
 */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function atlasDetail(url: URL): Partial<VoteLink> {
  const frag = safeDecode(url.hash.replace(/^#/, ""));
  const uuid = UUID_RE.exec(frag)?.[0]?.toLowerCase();
  if (uuid) return { uuid };
  const docNo = DOCNO_RE.exec(frag)?.[0];
  return docNo ? { docNo } : {};
}

// Powerhouse ids are not next-gen-atlas uuids, so only the doc_no embedded in
// the path or fragment ("A.1.9.2.1_Pause_Delay") is kept.
function powerhouseDetail(url: URL): Partial<VoteLink> {
  const where = safeDecode(url.pathname + url.hash);
  const docNo = DOCNO_RE.exec(where)?.[0];
  return docNo ? { docNo } : {};
}

function portalDetail(url: URL, text: string): Partial<VoteLink> {
  const [, section, id] = url.pathname.split("/");
  if (section === "executive") return { family: "executive" };
  if (section !== "polling") return { family: "other" };
  const pollId = POLL_ID_IN_TEXT_RE.exec(text)?.[1];
  return { ...(id ? { pollSlug: id } : {}), ...(pollId ? { pollId: Number(pollId) } : {}) };
}

function forumDetail(url: URL): Partial<VoteLink> {
  // /t/<slug>/<topic-id>[/<post>]
  const topic = /^\/t\/[^/]+\/(\d+)/.exec(url.pathname)?.[1];
  return topic ? { forumTopic: Number(topic) } : {};
}
