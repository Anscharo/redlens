import type { FeatureGroup } from "../features-types.ts";

export const reader: FeatureGroup = {
    key: "reader",
    title: "Reader",
    route: "/atlas",
    blurb:
      "Read the Atlas with a navigable tree, side-by-side notes, per-document history, and a comparison pane.",
    features: [
      {
        name: "Reading & the tree sidebar",
        what: "Browse the whole Atlas as a collapsible tree, with the selected section pinned while you scroll.",
        how: [
          "Open the Reader, or click any search result to jump to that document.",
          "Navigate the tree with the arrow keys and Enter; depth is colour-coded, and shift-clicking a row's chevron expands three levels at once.",
          "In the reader, the » button on a document opens and closes everything beneath it — alt-click reverses the direction it would go next.",
          "Each document carries a type pill plus buttons to copy its link or its doc number.",
          "The owning Prime or Executor Agent shows as a pill in the left gutter of the document.",
          "An Element Annotation shows an \"Annotates\" line under its doc number — click it to jump to the document it annotates; the Atlas orders the annotation well below that document.",
        ],
      },
      {
        name: "The right-hand panel",
        what: "Context for whichever document is selected — history, notes, onchain, and glossary in one scrolling panel, with pills at the top to jump between them. A section with nothing for the document is left out; history always shows, and it is where you land by default.",
        how: [
          "History — this document's change timeline, with the governance poll that approved each change where one links it (“approved by poll …”), and any Executive Vote that cites that poll (“cited by Executive Vote …”).",
          "Notes — the Element Annotations attached to this document, linked documents, equivalent documents under the other Prime Agents, which documents cite this one, and extracted relations.",
          "Onchain — for a document that states a Prime Agent instance's rate limits (or is the instance, or is the Rate Limits heading over them, or is a limit document listed under a Rate Limits heading and a chain heading, like Spark's Diamond PAU CCTP limits, or a vault instance's Take Rate Limits), `Atlas vs contract`: each maxAmount and slope the Atlas states beside what the PAU contract holds now, ✗ where they differ, a grey clock where the side that moved second is still coming: the spell the Atlas change belongs to, through the Prime's Snapshot poll that links its pull request or the spell the pull request names (hover it for the pull request, the poll, the spell and what it waits on: the poll still open, its Executive Vote not filed or not yet cast, its relay queued on the chain's Executor, or its changes still being read), or, where a spell changed the chain first, the open Atlas pull request that names it; a ✗ says, where it is known, whether that spell executed without the value, set it to another value or never carried it, whether the change is an artifact item no spell carries or its poll failed, whether the Atlas recorded a spell that had already run, which spell or Operator changed the chain since the Atlas last wrote the value and which Atlas pull request passed it by, or that the pull request names no spell; on any differing value it also says who can change the limit: a spell through its admin, and, where BeamState and the Configurator allow it, the Operator, with whether the Operator can bring it to the Atlas value (lower it at any time, raise it in a stated number of steps a hop apart, or not at all), and a note where they cannot be compared (contract not read yet, not set on the contract); then the Sky Executive Votes behind the document (each one that links it, and each one matched to one of its dates, labelled as on Stale Dates), linked to vote.sky.money and, once cast, to the spell contract, with how many PAU settings the spell changed on which chains and a link to each Prime Agent's PAU history; then the on-chain addresses the document names, each with its chain, labels, balances and live contract values.",
          "Glossary — the defined terms this document uses, with their Atlas definitions.",
        ],
      },
      {
        name: "Splitview",
        what: "Open a second document in a side pane to compare two areas at once.",
        how: [
          "Shift-click a document — a row in the tree, or its title in the reader — to open it in a second pane.",
          "The pane shows that document with its children; close it to return to single view. While the reader is narrowed to your selected documents, an open collection, or a preview's changed documents, a link to a document outside that set opens it in the pane, and the reader stays where it was.",
          "The pane lives in the URL (?split=…), so back/forward and a shared link both restore it.",
        ],
      },
      {
        name: "Selection & Collections",
        what: "Check documents, filter the tree to just your selection, and save it as a shareable named collection.",
        how: [
          "Tick the checkbox on any document in the Reader or search results.",
          "Shift-click a checkbox to grab that document and everything beneath it.",
          'In the bar at the top of the tree sidebar, click the "Selected · N" pill to narrow the tree from "All" down to your checked docs; the × next to it clears the selection.',
          'To save, click the save (disk) icon on the right of that same bar — its tooltip reads "Save as collection". The dialog lists the documents being saved. If one of your saved collections is open you can Update it, Save as new, or use Save as new, minus “name” (only the documents you added beyond it); hover or focus a button to preview what it would save (the preview stays until you hover another), and Update marks added documents + and removed ones −.',
          "The folder icon beside it opens /collections, where you can reopen, rename, delete, or copy a public share link for any saved collection. Each saved collection's card also carries a short generated name and one-line summary of what its documents are about (it is rewritten after you change the collection, and left out when it cannot be written).",
          'On /collections, switch from "My collections" to "Collections from conversations" to see one read-only collection per chat that cited documents, open it to read just those documents, or use its Share button to copy a public link that opens the same documents for anyone. A conversation collection (or a shared one) cannot be changed: check or uncheck a document after opening it and the pill goes back to "Selected", and saving makes a new collection of your own. Your own saved collections keep their name and can be updated.',
        ],
        note: "Saving and collections require signing in — use the sign-in control at the right of the top bar.",
      },
      {
        name: "History & version diffs",
        what: "See how any document changed over time, with before/after diffs and links to the upstream commit and PR.",
        how: [
          "The history section opens first in the right-hand panel, with the document's change timeline.",
          "Each entry shows the diff; heavily rewritten sentences appear as before/after blocks instead of word-by-word.",
          "A title change is its own entry (`retitled`), with removed words struck through and added words highlighted. A renumbering is its own entry, with the parts of the doc number that changed highlighted on both numbers (`renumbered A.1.9.4.1 → A.1.10.4.1`); a change to the document's type (the `[Core]`, `[Section]` … label in its heading) is its own entry too (`type changed [Core] → [Section]`).",
          "Pre-history covers the HTML-era reconstruction and the pre-git MIP/genesis origins, marked with provenance disclaimers.",
        ],
      },
      {
        name: "On-chain addresses in context",
        what: "Every address the Atlas mentions is resolved, labelled, and linked to the right explorer for its chain — the same way everywhere it appears.",
        how: [
          "Hover any address — in a document, a report, or a dashboard — to see its name (or the full address when it has none), its `owner` when the Atlas names one, the token balances it holds with each one's dollar value, and their total under `value`. The figure beside an address is that total (`$1.20M`), or `≈$1.20M+` when it holds a token with no price; prices come from DefiLlama and are refreshed every few hours. An address holding under $1 of priced tokens shows its main token amount instead. A multisig shows its live on-chain threshold (`threshold 3 / 5`) and owner addresses, plus `Atlas states …` when the Atlas gives a different threshold; outside the reader, the card ends with `in the Atlas:` links to the documents that mention the address. Hover a rate limit ID (a `0x…` key) in a document to see what each PAU contract holding it has it set to on chain: its maxAmount and its slope (refill per day), in the limit's token where it is known. A rate limit ID no PAU contract holds, but that a live read found never set, says `Not set on any chain` and lists the Prime Agent's chains it was read on (or `Not set where read` and the chains not read yet); any other hash stays plain text.",
          "Open a document's Onchain section in the right-hand panel: each address it mentions, whether by hex or by its chainlog name, shows as a card with its name, owner, roles, balances, and a chain-correct explorer link.",
        ],
      },
      {
        name: "Deep links & memory",
        what: "Every view is addressable, so you can share an exact spot and return to where you were.",
        how: [
          "The document, the panel tab, and the split pane are all in the URL — copy the address bar to share.",
          "Reopen the Reader to land back on the document you left off at.",
        ],
      },
    ],
  };
