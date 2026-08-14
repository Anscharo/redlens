// Feature catalog for the /features guide page. Data only — FeaturesPage.tsx
// renders it. Keep each `how` entry a short, concrete usage step naming the
// real control the user has to find.
//
// This is the single source of truth for "what can this app do", so it is
// deliberately one file even though it runs past the ~150-line convention —
// splitting the list would defeat the point of having one place to update.
// Ship a user-visible feature, add it here in the same PR (see CLAUDE.md).
//
// Accuracy rules, learned the hard way:
//   - Never hardcode a count that the app derives elsewhere (reports, MCP
//     tools). Counts drift the day after they ship; the /connect page reads
//     the tool count live, and ReportsIndex owns the report list.
//   - Sign-in providers are per-environment (authProviders()). Production
//     offers GitHub; say "sign in", not a fixed provider pair.
//   - Gesture copy must match src/lib/hintText.ts, which is what the footer
//     hint actually says when the user hovers the same control.

export interface Feature {
  name: string;
  what: string; // one line: what it is
  how: string[]; // concrete usage steps / tips
  note?: string; // caveat, sign-in requirement, or availability
}

export interface FeatureGroup {
  /** Also the section's hash anchor (/features#<key>), so it is a PUBLIC URL —
   *  renaming one breaks every link anyone saved or shared. Titles are free to
   *  be reworded; these are not. */
  key: string;
  title: string;
  route?: string; // primary in-SPA route for this area (must exist in ROUTES)
  href?: string; // destination that leaves the router (preview owns its own shell)
  blurb: string;
  features: Feature[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    key: "reader",
    title: "Reader",
    route: "/atlas",
    blurb:
      "Read the Atlas with a navigable tree, side-by-side annotations, per-document history, and a comparison pane.",
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
        ],
      },
      {
        name: "The right-hand panel",
        what: "Three tabs of context for whichever document is selected: annotations, glossary, and history.",
        how: [
          "Annotations — linked documents, equivalent documents under the other Prime Agents, mentioned addresses, and which documents cite this one.",
          "Glossary — the defined terms this document uses, with their Atlas definitions.",
          "History — this document's change timeline (the tab you land on by default).",
        ],
      },
      {
        name: "Splitview",
        what: "Open a second document in a side pane to compare two areas at once.",
        how: [
          "Shift-click a document — a row in the tree, or its title in the reader — to open it in a second pane.",
          "The pane shows that document with its children; close it to return to single view.",
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
          'To save, click the save (disk) icon on the right of that same bar — its tooltip reads "Save as collection".',
          "The folder icon beside it opens /collections, where you can reopen, rename, delete, or copy a public share link for any saved collection.",
        ],
        note: "Saving and collections require signing in — use the sign-in control at the right of the top bar.",
      },
      {
        name: "History & version diffs",
        what: "See how any document changed over time, with before/after diffs and links to the upstream commit and PR.",
        how: [
          "Open the history tab in the right-hand panel to get the document's change timeline.",
          "Each entry shows the diff; heavily rewritten sentences appear as before/after blocks instead of word-by-word.",
          "Pre-history covers the HTML-era reconstruction and the pre-git MIP/genesis origins, marked with provenance disclaimers.",
        ],
      },
      {
        name: "On-chain addresses in context",
        what: "Every address the Atlas mentions is resolved, labelled, and linked to the right explorer for its chain.",
        how: [
          "Hover an address in the text to see its name and any token balances it holds.",
          "Addresses in the annotations panel show as cards with their metadata and a chain-correct explorer link.",
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
  },
  {
    key: "search",
    title: "Search",
    blurb: "A full query language over the entire Atlas, with filters, jumps, and in-report scoping.",
    features: [
      {
        name: "Query language",
        what: "Broad, phrase, strict, and fuzzy search with field filters and exclusions.",
        how: [
          'Type terms for a broad search (partial words match); wrap in double quotes for a "phrase"; single quotes for a case-sensitive match.',
          "Add ~N to a term to allow N character edits — misaligment~1.",
          "Filter with title:, type:, and in:<doc number>; drop a term with a leading -.",
          "Type / for slash commands, or /h for the full query-syntax reference.",
        ],
      },
      {
        name: "Jump-to",
        what: "Go straight to a document or entity by identifier.",
        how: [
          "Enter a doc number, a 0x address, a Sky chainlog id, or a UUID (full, or an 8+ character prefix) to jump directly.",
          "Recent searches are remembered; results are labelled with the scope, agent, or ICD each hit lives under.",
        ],
      },
      {
        name: "Scoped in-report search",
        what: "On a report page, search filters that report's rows instead of the whole Atlas.",
        how: ["Open any report, then type in the search pill — it switches to that report and filters its rows in place."],
      },
    ],
  },
  {
    key: "radar",
    title: "Radar",
    route: "/radar",
    blurb: "Dashboards for every party in the Sky ecosystem — Agents, Facilitators, Alignment Conservers, and more.",
    features: [
      {
        name: "Actor dashboards",
        what: "A full profile per party: responsibilities, primitives, relationships, rewards, invoked instances, on-chain state, contact, and its own change history.",
        how: [
          "Open Radar and pick an actor from the list.",
          "Scan the dashboard sections; the composite party view ties an Agent's associated legal entities together as one party.",
        ],
      },
      {
        name: "Primitive dashboards & activation matrix",
        what: "See primitives and which actors have activated them.",
        how: ["From Radar, open a primitive to view its dashboard and activation matrix."],
      },
    ],
  },
  {
    key: "reports",
    title: "Reports",
    route: "/reports",
    blurb:
      "Purpose-built tables extracted straight from the Atlas — each with CSV export and shareable, URL-synced filters.",
    features: [
      {
        name: "Using a report",
        what: "Extracted, filterable tables you can narrow and export.",
        how: [
          "Open Reports and pick one — responsibilities by facilitator or GovOps, Active Data, integrator rewards, on-chain addresses, stale dates, modification frequency, processes, and more.",
          "Use the filter pills to narrow; the URL updates so you can share the exact filtered view.",
          "Click Download CSV to export — full or filtered, with UUIDs and direct Atlas links.",
        ],
      },
      {
        name: "AI-drafted assessments",
        what: "OEA Task Assessment and Risk Rules are rated by an LLM against a fixed published rubric, then human-reviewed.",
        how: [
          "Open OEA Task Assessment or Risk Rules; each row shows a rating plus per-task reasoning.",
          "Follow the link to the rubric page to see exactly what the ratings are scored against.",
        ],
        note: "Ratings are AI-drafted and human-reviewed — treat them as a starting point, not a verdict.",
      },
    ],
  },
  {
    key: "crossview",
    title: "CrossView",
    route: "/reports/crossview",
    blurb: "Alternate categorizations of the Atlas — its functional chunks, cross-cutting concepts, and defined terms.",
    features: [
      {
        name: "Reading the Atlas by shape",
        what: "Four views that cut across the document tree instead of following it.",
        how: [
          "Shape — hierarchical weight maps of scopes, agent artifacts, and primitives, so you can see which part of the Atlas is biggest.",
          "Concepts — a catalog of cross-cutting concepts with the evidence behind each.",
          "Audit — the audit trail for how that catalog was built.",
          "Glossary — every term the Atlas defines, in one list.",
        ],
      },
    ],
  },
  {
    key: "preview",
    title: "Preview",
    href: "/preview",
    blurb: "Read any Atlas PR, branch, or fork as a live redlined Atlas with every change marked inline.",
    features: [
      {
        name: "Previewing a change",
        what: "Turn a proposed Atlas edit into a readable, redlined view before it lands.",
        how: [
          "Open Preview and paste an Atlas PR, branch, or fork URL — or pick one from the open-PRs tab.",
          "The Changed-only filter hides untouched sections; the rollup badge counts what moved.",
          "Watch for the ⚠ UUID-swap warning (a document's identity changed) and the build-error detail if the preview failed to build.",
          "History inside a preview is scoped to that preview, so you can see the change against what it edits.",
        ],
        note: "Previewing a private fork requires signing in with GitHub, and only works if your account can already see that repository.",
      },
    ],
  },
  {
    key: "mcp",
    title: "Connect (MCP)",
    route: "/connect",
    blurb:
      "Connect your own AI assistant to the Atlas over MCP — tools for search, traversal, entities, history, and reports.",
    features: [
      {
        name: "Connecting a client",
        what: "Point Claude Code, Claude Desktop, Cursor/Windsurf, or any MCP client at the Atlas.",
        how: [
          "Open the Connect page and pick your client.",
          "Copy the setup snippet and paste it into your client's MCP configuration.",
          "Ask your assistant to search, traverse, look up an address, or pull a report — it cites the Atlas directly.",
          "The Connect page lists the live tool set, so it always matches what the server is actually serving.",
        ],
      },
    ],
  },
  {
    key: "constellations",
    title: "Constellations",
    route: "/constellations",
    blurb: "A visual graph of agents, facilitators, governance parties, and how they relate.",
    features: [
      {
        name: "Exploring the graph",
        what: "An interactive relationship map built from the Atlas graph.",
        how: ["Go to /constellations directly and explore the network."],
        note: "Direct-URL only — not linked from the navigation or the home page cards.",
      },
    ],
  },
  {
    key: "platform",
    title: "Across the app",
    blurb: "Behaviours and reference pages that support everything above.",
    features: [
      {
        name: "Keyboard & modifier hints",
        what: "The footer tells you what the arrow keys and shift-click do wherever you happen to be.",
        how: [
          "Hover a control that responds to a modifier — the hint appears in the bottom-left corner.",
          "Focus the tree or the search box and the hint switches to the keys that work there.",
        ],
      },
      {
        name: "Your viewing history",
        what: "A record of what you have been reading — recent and most-viewed documents, the areas of the Atlas you spend time in, and the report pages you came back to.",
        how: [
          'Open it from the menu button in the top-right corner, from "History" in the profile menu once signed in, or from the "history" link in the footer.',
          "Each card lists what you visited with a view count beside it; document links go straight back into the reader.",
          'Document trees group your reading by document number — open a tree to see the documents behind its count.',
          "Report and Radar rows remember the filters you had set, so the link restores that same view.",
          'Wipe the record at any time with "clear history".',
        ],
        note: "No sign-in needed — the record is kept in this browser only, never sent to a server, and visits older than 180 days are forgotten. A different browser or device has its own separate history.",
      },
      {
        name: "Sending feedback",
        what: "Report a bug or tell us what's missing, from wherever you hit it.",
        how: [
          'Click the "?" button in the top bar, or just press ? anywhere outside a text box.',
          "Describe what happened and send — the page you were on goes with it, so you don't have to explain where you were.",
          'The same box links back to this guide ("Everything you can do") and to the search syntax reference.',
        ],
      },
      {
        name: "Always-current Atlas",
        what: "The app tracks upstream and refreshes itself when the Atlas advances.",
        how: [
          'When a new Atlas version lands, an "atlas updated" pill appears in the footer — click it to reload into the new version.',
          "The footer also shows the live Atlas commit, node count, and the block the on-chain snapshot was taken at.",
        ],
      },
      {
        name: "Link unfurl cards",
        what: "Shared links render a preview image, per document, actor, report, or page.",
        how: ["Paste any Atlas link into Twitter, Slack, or Discord to get a server-rendered preview card."],
      },
      {
        name: "Reference pages",
        what: "Supporting pages for provenance, changes, search help, and privacy.",
        how: [
          "Provenance (/provenance) — how the data is built.",
          "Recent improvements (/updates) — the changelog.",
          "Search help (/search-hints) — the full query syntax.",
          "Privacy (/privacy).",
        ],
      },
    ],
  },
  {
    key: "upcoming",
    title: "Upcoming",
    blurb: "Planned features — not yet switched on. Details may change before release.",
    features: [
      {
        name: "Chat",
        what: "Ask the Atlas questions and get answers backed by inline sources and a verification badge.",
        how: [
          "Sign in, then open Chat and ask a question — it will know the document or report you're viewing.",
          "Check the answer's verification badge and click the inline sources to jump to the cited docs.",
          "Open the tool trace to see what it queried; the meter shows your usage / credits.",
          "Dock the panel to the side or let it float.",
        ],
        note: "Will require signing in.",
      },
    ],
  },
];
