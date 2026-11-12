import type { FeatureGroup } from "../features-types.ts";

export const search: FeatureGroup = {
    key: "search",
    title: "Search",
    blurb: "A full query language over the entire Atlas, with filters, jumps, and in-report scoping.",
    features: [
      {
        name: "Query language",
        what: "Broad, phrase, strict, and fuzzy search with field filters and exclusions.",
        how: [
          'Type terms for a broad search (partial words match). Wrap a phrase in double quotes for a literal substring (case-insensitive), or single quotes for case-sensitive.',
          "Broad search also matches the singular or plural of each word; documents that use your exact word rank first.",
          "Add ~N to a term to allow N character edits — misaligment~1. You rarely need it: a search that finds nothing offers a spelling correction you can click.",
          "Filter with title:, type:, and in:<doc number>; drop a term with a leading -.",
          "While reading a document, press the in: button beside the search box (on wider screens it reads in:<doc number>*, and hovering it names the document) to search only that document and everything under it; press it again to search the whole Atlas. The scope stays outside any quotes the a* / \"a\" / Aa buttons add.",
          "On a phone the three mode buttons fold into one: tap it to step through a* (broad), \"a\" (phrase) and Aa (strict).",
          "Type / for slash commands, or /h for the full query-syntax reference.",
        ],
      },
      {
        name: "Wording or meaning",
        what: "Two indexes behind the same search box: the words you typed, or what a document is about.",
        how: [
          "Search, then use the wording / meaning pills on the right of the result count line to switch index.",
          "A result the meaning index found is labelled semantic match and shows its similarity score; it can share no word at all with your query.",
          "Add in:<doc number> to scope meaning search to one subtree — in:A.6 who approves rewards searches only the Agent Scope.",
          "On the meaning pill the a* / \"a\" / Aa mode buttons are greyed out, and any other search syntax you type — type:, title:, -word, ~2, quotes — is dropped, with a note above the results naming what it dropped. in: is the exception and still applies. If a word you typed doesn't look like a word (xkcdq, a1b2c), the meaning pill shows wording matches and a note naming it instead of searching; press Enter to search by meaning anyway.",
        ],
        note: "Meaning-matched results appear on the meaning pill and nowhere else — wording searches stay wording searches. That pill needs a deployment configured for it; where it is not, it is disabled and says so. Signed-out readers share one meaning-search allowance; where sign-in is offered, a signed-in reader gets an hourly allowance of their own, and the results page offers sign-in when the shared one runs out.",
      },
      {
        name: "Jump-to",
        what: "Go straight to a document or entity by identifier.",
        how: [
          "Type a document's number to go to it (6.1.2 or A.6.1.2). Enter a Sky chainlog id or a UUID (full, or an 8+ character prefix) to jump directly. An address prefix (0x…) finds every node that cites a matching address.",
          "Recent searches are remembered; results are labelled with the scope, agent, or ICD each hit lives under.",
        ],
      },
      {
        name: "Scoped in-report search",
        what: "On a report page, search filters that report's rows instead of the whole Atlas.",
        how: ["Open any report, then type in the search pill — it switches to that report and filters its rows in place."],
      },
    ],
  };
