// Feature catalog for the /features guide page. Data only — FeaturesPage.tsx
// renders it. Lives in src/lib (not src/components) because the SERVER reads it
// too: the chat's product-documentation fact imports it, and the runtime image
// copies src/lib but not src/components. Keep each `how` entry a short, concrete usage step naming the
// real control the user has to find.
//
// This is the single source of truth for "what can this app do", so it is
// deliberately one file even though it runs past the ~150-line convention —
// splitting the list would defeat the point of having one place to update.
// Ship a user-visible feature, add it here in the same PR (see CLAUDE.md).
//
// It is no longer only the /features page: the chat's product-documentation
// fact (src/server/facts/features.ts) injects this data verbatim when someone
// asks what the app can do, so anything stale here is stale in the chat's
// answers too.
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
          "An Element Annotation shows an \"Annotates\" line under its doc number — click it to jump to the document it annotates; the Atlas orders the annotation well below that document.",
        ],
      },
      {
        name: "The right-hand panel",
        what: "Three tabs of context for whichever document is selected: annotations, glossary, and history.",
        how: [
          "Annotations — the Element Annotations attached to this document, linked documents, equivalent documents under the other Prime Agents, mentioned addresses, and which documents cite this one.",
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
      {
        name: "MSC ecosystem overview",
        what: "The Radar front page opens with a cross-prime Monthly Settlement Cycle view: an orbital chart — Sky as a central donut, split into one wedge per Prime that paid into it, with each Prime orbiting as a circle sized by its gross revenue (prime agent revenue + demand-side + Sky Direct Exposure, before cost of funds) holding a floating stacked bar of what it kept (supply kept and demand-side above its zero line, a supply loss striped below) and an arrow running from it to its wedge — next to a stacked timeline of what each Prime kept, with Sky's monthly take overlaid as a line.",
        how: [
          "Open Radar; the orbital chart (titled Sky System Settlements) shows the latest settled month across all Primes, with the color key and reading guide under it. Primes keep one fixed order and color everywhere on the overview — the Atlas's own Prime Agent order (Spark, Grove, Keel, Skybase, Obex, Pattern, Osero, Launch Agent 7).",
          "Click a month column in the Prime-side earnings chart to switch the orbital chart and the figures under it.",
          "Hover a Prime's circle for its gross revenue, a bar segment or Sky wedge for its figure, or an arrow for its cost of funds and Sky Direct Exposure components, the To-Sky total and the share of that Prime's gross revenue it is; hover a timeline segment to light that Prime up on the orbital chart.",
          "Click a Prime's plate to open its settlement page for the month you had selected.",
        ],
        note: "Bar heights share one square-root scale so the smallest Primes stay visible, and a Prime with a negative supply kept shows it hanging below its zero line rather than disappearing. To Sky is a pass-through (cost of funds + Sky Direct Exposure), not the Prime's revenue, so it is never part of a Prime's bar — it lives in the arrow and Sky's donut. A share over 100% on an arrow is real: that Prime owed Sky more than it made that month. Hidden when settlements.json has not been built. Figures are Soter Labs OEA calculations, not the on-chain GovOps spell.",
      },
      {
        name: "Monthly settlement charts",
        what: "On primes that publish a Monthly Settlement Cycle workbook, the actor page shows last month's take; a full cycle page charts Sky's share, supply kept, and demand-side, plus the demand-side mix and venue AUM.",
        how: [
          "Open a Prime Agent on Radar (Spark, Grove, Obex, …).",
          "The Monthly settlement card in the top right shows the latest cycle; the `full cycle` link under the figure opens the charts.",
          "On that page, Sky Forum opens the forum post for the month selected in the charts.",
          "Ask Chat or an MCP client about a month's To Sky / supply kept / demand-side — it will say those figures are not from the Atlas.",
          "On the cycle page, click a month in the Summary bars. Primes with several venues have a PnL / AUM toggle.",
          "In the venue flow chart, hover a flow, a venue name, or its row in the table below — that venue lights up in both, and its figures appear on the flows.",
          "Click the Sky label beside the venue flow chart to open that month in the ecosystem overview on the Radar front page.",
          "A sink with loss-making venues gets two bars: what came in (`$X gross in`) and, in red just below it, what went back out (`−$Y out`), with the `net` the pair settles to underneath. A longer red bar than green means the month went backwards.",
        ],
        note: "Hidden when settlements.json has not been built (`pnpm settlements:parse`). Figures are Soter Labs OEA calculations, not the on-chain GovOps spell. Chat and MCP can answer the same views — they always say the numbers are not from the Atlas.",
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
    key: "chat",
    title: "Chat",
    blurb:
      "Ask the Atlas questions from any page and get answers backed by inline sources and a verification badge.",
    features: [
      {
        name: "Asking the Atlas",
        what: "A page-aware agent that reads the Sky Atlas and cites the documents it used.",
        how: [
          "Click the Atlas agent launcher in the bottom-right (it shows ⌘K), or press ⌘K / Ctrl-K — it already knows the document or report you're viewing.",
          "Ask it what the app can do, or what it can do itself — it answers from this guide, and keeps the two apart.",
          "Ask about a Prime Agent's monthly settlement dollars — Chat uses an isolated helper on Soter Labs workbooks / Sky Forum and says those figures are not from the Atlas.",
          "Ask across every Prime at once — top venues by revenue, ecosystem totals, or a range of months — not just one Prime at a time.",
          "Ask it to draft a message to someone else explaining what the Atlas says; the draft carries links to the source documents, and you can export it to send.",
          "Check the answer's verification badge and click the inline sources to jump to the cited docs — an answer still being checked shows in italics.",
          "The usage meter under the composer shows your usage / credits; click the pie to see every limit.",
          "Dock the panel to the side with the dock icon in the header, or pop it out to a floating window.",
          'Past chats live under "Conversations" in the profile menu, and as "continue a previous chat" in an empty panel.',
        ],
        note: "Asking a question requires signing in — use the sign-in control at the right of the top bar, or the Sign in buttons in the panel.",
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
          "Monthly settlement dollar questions use `external_msc` (Soter Labs workbooks / Sky Forum) — that tool is labeled not-Atlas.",
          "The Connect page lists the live tool set, so it always matches what the server is actually serving.",
        ],
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
        name: "Colour schemes",
        what: "The whole app can run in the original charcoal dark scheme, a high-contrast greyscale one, or a light one.",
        how: [
          "Click the sun, moon, or eclipse button in the top-right corner — it shows which scheme is on — and pick Dark, Giedi, or Light.",
          "Every page follows the choice — the reader, Radar, reports, and the Atlas agent.",
        ],
        note: "No sign-in needed. Until you pick one, the app follows your device's light/dark setting and keeps following it; once you choose, that choice sticks. It is kept in this browser only, so another browser or device starts from your device setting again.",
      },
      {
        name: "Your viewing history",
        what: "A record of what you have been reading — recent and most-viewed documents, the areas of the Atlas you spend time in, and the report pages you came back to.",
        how: [
          'Open it from the menu button in the top-right corner, or from "History" in the profile menu once signed in.',
          "Recently viewed documents says how long ago you opened each one; the other three cards carry a view count. Document links go straight back into the reader.",
          'Document trees group your reading by document number — open a tree to see the documents behind its count.',
          "Report and Radar rows remember the filters you had set, so the link restores that same view.",
          'Wipe the record at any time with "clear history".',
        ],
        note: "No sign-in needed — the record is kept in this browser only and never sent to a server; the page itself states how long visits are kept. A different browser or device has its own separate history.",
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
];
