export interface GlossaryEntry {
  term: string;
  content: string;
  nodeId: string;
  docNo: string;
  sourceDocNo: string;
  sourceContext: string | null;
}

export type Glossary = Record<string, GlossaryEntry[]>;

type GlossaryLookup = Record<string, GlossaryEntry[]>;

let cached: Promise<Glossary> | null = null;

export function loadGlossary(): Promise<Glossary> {
  if (!cached) {
    const BASE = import.meta.env.BASE_URL;
    cached = fetch(`${BASE}glossary.json`).then((r) => r.json()).then((f) => f.terms ?? f);
  }
  return cached;
}

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
