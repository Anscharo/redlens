// Feature catalog for the /features guide page. Data only — FeaturesPage.tsx
// renders it. Keep each `how` entry a short, concrete usage step. Accuracy
// notes: sign-in is GitHub OR Google; the MCP server exposes 24 tools; there
// are 8 reports + a rubric page; Constellations is reachable by direct URL
// only (absent from the nav).

export interface Feature {
  name: string;
  what: string; // one line: what it is
  how: string[]; // concrete usage steps / tips
  note?: string; // caveat, sign-in requirement, or availability
}

export interface FeatureGroup {
  key: string;
  title: string;
  route?: string; // primary in-app route for this area, if any
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
          "Use the left tree to navigate; arrow keys move between rows.",
          "Expand a branch, or use expand-all / expand-children; depth is colour-coded.",
        ],
      },
      {
        name: "Split View",
        what: "Open a second document in a side pane to compare two areas at once.",
        how: [
          "Shift-click any document (in the tree, content, or a link) to open it in a second pane.",
          "The pane shows that document with its children; close it to return to single view.",
        ],
      },
      {
        name: "Selection & Collections",
        what: "Check documents, filter the tree to just your selection, and save it as a shareable named collection.",
        how: [
          "Tick the checkbox on any document in the Reader or search results.",
          "Shift-click a checkbox to grab that document and all of its descendants.",
          "Filter the tree to only your selection, then Save as a Collection and share the public link.",
        ],
        note: "Saving requires sign-in (GitHub or Google).",
      },
      {
        name: "History & version diffs",
        what: "See how any document changed over time, with before/after diffs and links to the upstream commit and PR.",
        how: [
          "On a document, toggle History to open its change timeline.",
          "Each entry shows the diff; heavily rewritten sentences appear as before/after blocks.",
          "Pre-history covers the HTML-era reconstruction and pre-git origins, with provenance disclaimers.",
        ],
      },
      {
        name: "Annotations panel",
        what: "Context for the current document: definitions, related docs, on-chain addresses, and the owning agent.",
        how: [
          "Read alongside the document: Glossary terms, Linked and cousin documents, and back-references.",
          "Mentioned addresses show as cards with metadata and chain-correct explorer links.",
          "The Agent pill shows which Prime or Executor Agent owns the document.",
        ],
      },
      {
        name: "Deep links & memory",
        what: "Every view is addressable, so you can share an exact spot and return to where you were.",
        how: [
          "The document, annotation view, and split pane are all in the URL — copy the address bar to share.",
          "Reopen the Reader to land back where you left off.",
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
          'Type terms for a broad search; wrap in quotes for an exact "phrase"; add ~N for fuzzy.',
          "Filter with title:, type:, and in:; exclude a term with a leading -.",
          "Type /h for the full query-syntax help page.",
        ],
      },
      {
        name: "Jump-to",
        what: "Go straight to a document or entity by identifier.",
        how: [
          "Enter a doc number, a 0x address, a chainlog id, or a full/partial UUID to jump directly.",
          "Recent searches are remembered; results carry context labels (scope / agent / ICD).",
        ],
      },
      {
        name: "Scoped in-report search",
        what: "On a report page, search filters that report's rows instead of the whole Atlas.",
        how: ["Open any report, then type in the search pill to filter its rows in place."],
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
        what: "A full profile per party: responsibilities, primitives, relationships, rewards, instances, on-chain state, and contact.",
        how: [
          "Open Radar and pick an actor from the list.",
          "Scan the dashboard sections; the composite party view ties related entities together.",
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
    blurb: "Eight purpose-built reports plus a rubric page — each with CSV export and shareable, URL-synced filters.",
    features: [
      {
        name: "Using a report",
        what: "Extracted, filterable tables you can narrow and export.",
        how: [
          "Open Reports and pick one (e.g. Op Facilitator responsibilities, Active Data, Rewards, Stale Dates, Processes).",
          "Use the filter pills to narrow; the URL updates so you can share the exact filtered view.",
          "Click Download CSV to export — full or filtered, with UUIDs and direct Atlas links.",
        ],
      },
      {
        name: "AI-drafted assessments",
        what: "OEA Assessment and Risk Rules are rated by an LLM against a fixed published rubric, then human-reviewed.",
        how: [
          "Open OEA Assessment or Risk Rules; each row shows a rating plus per-task reasoning.",
          "Follow the link to the rubric page to see exactly what the ratings are scored against.",
        ],
        note: "Ratings are AI-drafted and human-reviewed — treat them as a starting point, not a verdict.",
      },
    ],
  },
  {
    key: "mcp",
    title: "Connect (MCP)",
    route: "/connect",
    blurb: "Connect your own AI assistant to the Atlas over MCP — 24 tools for search, traversal, history, and reports.",
    features: [
      {
        name: "Connecting a client",
        what: "Point Claude Code, Claude Desktop, Cursor/Windsurf, or any MCP client at the Atlas.",
        how: [
          "Open the Connect page and pick your client.",
          "Copy the setup snippet and paste it into your client's MCP configuration.",
          "Ask your assistant to search, traverse, look up an address, or pull a report — it cites the Atlas directly.",
        ],
      },
    ],
  },
  {
    key: "preview",
    title: "Preview",
    blurb: "Read any Atlas PR, branch, or fork as a live redlined Atlas with every change marked inline.",
    features: [
      {
        name: "Previewing a change",
        what: "Turn a proposed Atlas edit into a readable, redlined view before it lands.",
        how: [
          "Open Preview and paste an Atlas PR, branch, or fork URL.",
          "Use the open-PRs tab to pick one; the Changed-only filter hides untouched sections.",
          "Watch for the ⚠ UUID-swap warning (an identity change) and the build-error detail if a build failed.",
        ],
        note: "Available when preview is enabled for the deployment.",
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
        how: ["Go to /constellations directly (it isn't in the main nav) and explore the network."],
        note: "Direct-URL only — not linked from the navigation or home page cards.",
      },
    ],
  },
  {
    key: "platform",
    title: "Across the app",
    blurb: "Behaviours and reference pages that support everything above.",
    features: [
      {
        name: "Always-current Atlas",
        what: "The app tracks upstream and refreshes itself when the Atlas advances.",
        how: [
          "When a new Atlas version lands, the app detects it and offers a one-click reload.",
          "The footer shows the live Atlas commit, node count, and chain-state block.",
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
    blurb: "Planned features — not yet available. Details may change before release.",
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
        note: "Will require sign-in (GitHub or Google).",
      },
    ],
  },
];
