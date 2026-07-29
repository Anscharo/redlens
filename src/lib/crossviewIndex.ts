// Parses the II.7 "Topics (A–Z → section)" list directly out of the raw
// concepts.md source (mirrors crossviewHeadings.ts's parse-the-source
// approach — no DOM query) into {topic, targets} entries shared by the
// in-doc linkified list (crossviewMarkdownComponents.tsx) and the right-hand
// topic index panel (CrossViewTopicIndex.tsx). One parse, two renders, so
// they can never disagree on a target's slug.
//
// Two target species (per the recategorization framing this section
// actually has): a "unit" target names one specific concept unit ("Instruments
// 1") and links straight to that unit's anchor (see groupRefSlug, shared with
// the unit-opener id assignment in crossviewMarkdownComponents.tsx so the two
// always agree). A "category" target spans a whole family — either an
// explicit range ("Norms 1–9") or a bare family name ("Lifecycle", after
// stripping a legacy parenthetical like "(II.4)") — and links once to that
// family's section heading instead of enumerating every unit in it.
// Anything else (a bare doc_no like "A.4.5", an unrecognized family) is
// "unresolved": kept as plain display text, slug null.
import { slugify } from "./slug";
import type { CrossViewHeading } from "./crossviewHeadings";

export type CrossViewIndexTargetKind = "unit" | "category" | "unresolved";

export interface CrossViewIndexTarget {
  label: string;
  slug: string | null;
  kind: CrossViewIndexTargetKind;
}

export interface CrossViewIndexEntry {
  topic: string;
  targets: CrossViewIndexTarget[];
}

/** Slug for a specific concept unit, e.g. groupRefSlug("Instruments", "1") ===
 *  "instruments-1" — the exact id crossviewMarkdownComponents.tsx stamps onto
 *  that unit's opener paragraph. Single source of truth for that mapping. */
export function groupRefSlug(family: string, num: string): string {
  return slugify(`${family} ${num}`);
}

// Family name → the h2/h3 heading text that contains that family's units
// (from Part I's concept catalog). Two families (Norms, Instruments) share
// one heading — the catalog never split them into their own subheadings.
const GROUP_SECTION_HEADING: Record<string, string> = {
  Meta: "Meta-concepts (the Atlas describing itself)",
  Lifecycle: "Lifecycle concepts (the primitive machine)",
  Process: "Procedural concepts",
  Norms: "Normative & instrument concepts",
  Instruments: "Normative & instrument concepts",
  Quantities: "Quantitative concepts",
  Economics: "Programs & economic machinery (deep-dive merge)",
  Actors: "Relational/social concepts (the entity layer)",
  Duties: "Duties & responsibilities",
  Registries: "Registry concepts",
};

// The `:::index` / `:::endindex` pair is the same marker CrossViewMarkdown.tsx
// scans for to swap this block out of the plain-markdown pass — using it
// here too (rather than locating the "### II.7" heading by text) means the
// section boundary is defined in exactly one place in the source, and
// survives the heading being reworded again later.
const INDEX_MARKER_RE = /^:::index\s*$\n([\s\S]*?)\n^:::endindex\s*$/m;
const ENTRY_LINE_RE = /^- (.+?) → (.+)$/gm;
const PAREN_SUFFIX_RE = /^(.*?)\s*\(([^)]*)\)\s*$/;
const UNIT_RE = /^([A-Za-z]+)\s+(\d+)$/;
const RANGE_RE = /^([A-Za-z]+)\s+\d+[–-]\d+$/;
const BARE_FAMILY_RE = /^([A-Za-z]+)$/;

/** Raw body text between `:::index` and `:::endindex`, or "" if the markers
 *  aren't present. */
export function extractIndexSectionRaw(raw: string): string {
  return INDEX_MARKER_RE.exec(raw)?.[1] ?? "";
}

function sectionSlugFor(family: string, headings: CrossViewHeading[]): string | null {
  const headingText = GROUP_SECTION_HEADING[family];
  if (!headingText) return null;
  return headings.find((h) => h.text === headingText)?.slug ?? null;
}

function parseTarget(raw: string, headings: CrossViewHeading[]): CrossViewIndexTarget {
  const label = raw.trim();
  const parenMatch = PAREN_SUFFIX_RE.exec(label);
  const base = (parenMatch ? parenMatch[1] : label).trim();

  const unitMatch = UNIT_RE.exec(base);
  if (unitMatch) {
    return { label, slug: groupRefSlug(unitMatch[1], unitMatch[2]), kind: "unit" };
  }

  const rangeMatch = RANGE_RE.exec(base);
  if (rangeMatch) {
    return { label, slug: sectionSlugFor(rangeMatch[1], headings), kind: "category" };
  }

  const bareMatch = BARE_FAMILY_RE.exec(base);
  if (bareMatch) {
    const slug = sectionSlugFor(bareMatch[1], headings);
    if (slug) return { label, slug, kind: "category" };
  }

  return { label, slug: null, kind: "unresolved" };
}

/** Parse the II.7 section straight out of concepts.md's raw source into
 *  {topic, targets} entries. `headings` must be extractHeadings(raw) (or a
 *  superset) so category targets can resolve their family's section slug. */
export function parseCrossViewIndex(raw: string, headings: CrossViewHeading[]): CrossViewIndexEntry[] {
  const body = extractIndexSectionRaw(raw);
  const entries: CrossViewIndexEntry[] = [];
  for (const m of body.matchAll(ENTRY_LINE_RE)) {
    const topic = m[1].trim();
    const targets = m[2]
      .trim()
      .split("/")
      .map((t) => parseTarget(t, headings));
    entries.push({ topic, targets });
  }
  return entries;
}

export type GroupedTargets =
  | { mode: "compact"; family: string; nums: { num: string; slug: string | null }[] }
  | { mode: "full"; targets: CrossViewIndexTarget[] };

const LABEL_UNIT_RE = /^([A-Za-z]+)\s+(\d+)$/;

/** Two+ "unit" targets sharing one family ("Economics 3", "Economics 4") get
 *  a compact "Economics 3 · 4" rendering; anything else renders each target's
 *  full label. Used by both CrossViewIndexList (in-doc) and CrossViewTopicIndex
 *  (right panel) so the two agree on when to compact. */
export function groupTargetsForDisplay(targets: CrossViewIndexTarget[]): GroupedTargets {
  if (targets.length > 1) {
    const parsed = targets.map((t) => LABEL_UNIT_RE.exec(t.label));
    const families = parsed.map((m) => m?.[1]);
    if (parsed.every((m) => m) && families.every((f) => f === families[0])) {
      return {
        mode: "compact",
        family: families[0] as string,
        nums: targets.map((t, i) => ({ num: (parsed[i] as RegExpExecArray)[2], slug: t.slug })),
      };
    }
  }
  return { mode: "full", targets };
}
