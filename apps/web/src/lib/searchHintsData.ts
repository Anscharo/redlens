export interface SearchHint {
  label: string;
  query: string;
  description: string;
}

export interface SearchHintGroup {
  title: string;
  /** One line of context for the whole group, shown beside its heading. */
  note?: string;
  hints: SearchHint[];
}

// Ordered most-useful-first. Filters lead because they are the part of the
// query language nothing in the UI hints at; the three modes come later
// because they are also the pills beside the search bar.
export const HINT_GROUPS: SearchHintGroup[] = [
  {
    title: "Narrow a search",
    note: "Filters combine with plain terms in any order.",
    hints: [
      {
        // A.1.6 is Aligned Delegates: 62 of its 76 documents match "delegate",
        // so the example survives ordinary edits. search-hints.artifact.test.ts
        // fails if a renumbering ever empties it.
        label: "in:DOC_NUMBER",
        query: "in:A.1.6 delegate",
        description: "Restrict results to a section subtree",
      },
      {
        label: "exclude term",
        query: "alignment -slippery",
        description: "Prefix with - to exclude a term",
      },
      {
        // title:/content:/doc_no: and type: are the same idea to a reader, so
        // they are one row each rather than the three separate "field:"/"type:"/
        // "type (spaces)" rows this replaced. Quoting is verified in
        // search-hints.artifact.test.ts: title:"Aligned Delegate" returns
        // exactly the 18 documents with that text in their title.
        label: '[field]:"Term"',
        query: 'title:"Risk"',
        description: "Risk must be in the title field — also content: and doc_no:",
      },
      {
        label: '[field]:"Two Words"',
        query: "type:Scenario_Variation",
        description: 'type must be Scenario Variation — underscore, or quote it: type:"Scenario Variation"',
      },
    ],
  },
  {
    title: "Combine filters",
    note: "Stack as many as you like — every filter applies at once.",
    hints: [
      {
        label: "scope + type + phrase",
        query: 'in:A.1 type:Core "alignment requirement"',
        description: "Restrict to a section subtree, filter by node type, match an exact phrase",
      },
      {
        label: "filters + exclude",
        query: "title:facilitator type:Core -operational",
        description: "Two field filters plus an exclusion, all applied at once",
      },
    ],
  },
  {
    title: "Match modes",
    note: 'The a* / "a" / Aa buttons beside the search bar switch between these three.',
    hints: [
      {
        label: "broad",
        query: "govern",
        description: "Default mode — partial words match automatically, case-insensitive",
      },
      {
        label: "phrase",
        query: '"properly implemented"',
        description: "Double quotes — literal substring match, case-insensitive",
      },
      {
        label: "strict",
        query: "'delegatedSigners'",
        description: "Single quotes — literal substring match, case-sensitive",
      },
    ],
  },
  {
    title: "Jump by identifier",
    note: "Paste any of these straight into the search bar.",
    hints: [
      { label: "doc number", query: "A.1.2", description: "Jump directly to a section by number" },
      {
        label: "uuid",
        query: "a491d7d0",
        description: "Jump to a doc by UUID — the full id, or a partial prefix (8+ hex)",
      },
      {
        label: "0x address",
        query: "0xbe8e3e",
        description: "All nodes containing matched Ethereum address",
      },
      {
        label: "chainlog id",
        query: "MCD_VAT",
        description: "All nodes referencing a Sky chainlog contract",
      },
    ],
  },
];
