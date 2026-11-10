// The spell items a Prime's "Proposed Changes … for Upcoming Spell" forum
// thread lists, read from the Operational Facilitator's posts that pair each
// item with its Snapshot poll and its atlas pull request(s):
//
//   <p>[Base] Grove × Steakhouse USDC Vault on Base - Onboard the Vault …</p>
//   <ul><li><a href="…/s:grovefinance.eth/proposal/0x014c…">Snapshot Poll</a></li>
//       <li><a href="…/next-gen-atlas/pull/332">Pull Request</a></li></ul>
//
// The quoted summary above those pairs says which kind each item is: "New
// Spell Items" (a spell carries it), "Grove Artifact" / "Spark Artifact" (an
// artifact change, applied off-spell) or "Sky Core Requests" (Sky Core's own
// spell). A Snapshot poll is what an executive's Prime Agent Proxy Spells
// section links, so it names the spell that carries the item. Pure.

export type ItemGroup = "spell" | "artifact" | "core";

export interface ForumSpellItem {
  topic: number;
  post: number;
  title: string;
  /** The summary heading the item sits under; null when the post has none that matches. */
  group: ItemGroup | null;
  /** The Snapshot proposal id, lowercased; null when the item links none. */
  snapshot: string | null;
  prs: number[];
  /** The spell date the thread's slug names ("…/november-5-2026-proposed-changes-…"), YYYY-MM-DD; null when it names none. */
  threadDate: string | null;
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(s.toLowerCase().replace(/→/g, " to ").split(/[^a-z0-9]+/).filter((w) => w.length > 1));

/** The group a summary heading names. */
function groupOf(heading: string): ItemGroup | null {
  if (/spell items/i.test(heading)) return "spell";
  if (/artifact/i.test(heading)) return "artifact";
  if (/sky core/i.test(heading)) return "core";
  return null;
}

/** Each summary item's words and group: a heading paragraph, then the list under it. */
function summaryGroups(html: string): { words: Set<string>; group: ItemGroup }[] {
  const out: { words: Set<string>; group: ItemGroup }[] = [];
  for (const m of html.matchAll(/<p>([^<]{3,60})<\/p>\s*<ol[^>]*>([\s\S]*?)<\/ol>/g)) {
    const group = groupOf(m[1]);
    if (!group) continue;
    for (const li of m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)) out.push({ words: words(text(li[1])), group });
  }
  return out;
}

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length / Math.max(1, new Set([...a, ...b]).size);

/** The group a paired item belongs to: its summary line (most words in common, at least half), else the kind its own title names. */
function itemGroup(title: string, summary: { words: Set<string>; group: ItemGroup }[]): ItemGroup | null {
  const w = words(title);
  const best = summary.map((s) => ({ s, o: overlap(w, s.words) })).sort((a, b) => b.o - a.o)[0];
  if (best && best.o >= 0.5) return best.s.group;
  return /^\[[^\]]*artifact\]/i.test(title) ? "artifact" : /^\[sky core\]/i.test(title) ? "core" : null;
}

/** Every item one post pairs with a Snapshot poll and at least one atlas pull request. */
export function postSpellItems(html: string, topic: number, post: number, threadDate: string | null): ForumSpellItem[] {
  const summary = summaryGroups(html);
  return [...html.matchAll(/<p>((?:(?!<\/?p>)[\s\S])*?)<\/p>\s*<ul>([\s\S]*?)<\/ul>/g)].flatMap((m) => {
    const prs = [...m[2].matchAll(/next-gen-atlas\/pull\/(\d+)/g)].map((p) => Number(p[1]));
    if (prs.length === 0) return [];
    const title = text(m[1]);
    const snapshot = /proposal\/(0x[0-9a-fA-F]{64})/.exec(m[2])?.[1].toLowerCase() ?? null;
    return [{ topic, post, title, group: itemGroup(title, summary), snapshot, prs: [...new Set(prs)], threadDate }];
  });
}
