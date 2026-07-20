// Pure glossary types + alias-flattening lookup builder. Shared by the frontend
// loader (src/lib/glossary.ts) and the server indexes (src/server/indexes.ts) —
// no fetch, no browser globals, so the server can import it directly.
export interface GlossaryEntry {
  term: string;
  content: string;
  nodeId: string;
  docNo: string;
  sourceDocNo: string;
  sourceContext: string | null;
}

export type Glossary = Record<string, GlossaryEntry[]>;

export type GlossaryLookup = Record<string, GlossaryEntry[]>;

export function buildLookup(glossary: Glossary): GlossaryLookup {
  const lookup: GlossaryLookup = {};
  const add = (key: string, entries: GlossaryEntry[]) => {
    const k = key.toLowerCase();
    if (lookup[k]) return;
    lookup[k] = entries;
  };

  for (const entries of Object.values(glossary)) {
    for (const e of entries) {
      add(e.term, entries);
      // Parenthetical alias: "Accessibility Scope (ACC)" → add "Accessibility
      // Scope" and "ACC" as separate keys pointing to the same entries.
      const m = e.term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (m) {
        add(m[1].trim(), entries);
        add(m[2].trim(), entries);
      }
      // "Sky "-prefixed terms ("Sky Primitives", "Sky Forum", "Sky Staking")
      // are still the answer to a bare mention of the concept ("what is a
      // primitive") — register the remainder too, plus a naive singular
      // ("Primitives" → "Primitive") since the source term is often plural
      // but the bare mention usually isn't. Requires a space after "Sky" so
      // single-word proper nouns like "Skylink" are untouched. add()'s
      // first-writer-wins guard means a genuinely distinct existing term
      // (there is none today) would keep precedence over this alias.
      const sky = e.term.match(/^Sky\s+(.+)$/i);
      if (sky) {
        const rest = sky[1].trim();
        add(rest, entries);
        if (rest.toLowerCase().endsWith("s") && !rest.toLowerCase().endsWith("ss")) add(rest.slice(0, -1), entries);
      }
    }
  }
  return lookup;
}
