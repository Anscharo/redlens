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
    }
  }
  return lookup;
}
