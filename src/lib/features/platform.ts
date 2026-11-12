import type { FeatureGroup } from "../features-types.ts";

export const platform: FeatureGroup = {
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
        what: "The whole app can run in the original charcoal dark scheme, a high-contrast greyscale one, a light one, or Winter — a cool white one with purple document titles and doc numbers that run from purple through navy to blue as documents nest deeper.",
        how: [
          "Click the sun, moon, eclipse, or snowflake button in the top-right corner — it shows which scheme is on — and pick Dark, Giedi, Light, or Winter.",
          "Every page follows the choice — the reader, Radar, reports, and Redline Portal Chat.",
        ],
        note: "No sign-in needed. Until you pick one, the app starts in Light, whatever your device's light/dark setting; once you choose, that choice sticks. It is kept in this browser only, so another browser or device starts in Light again.",
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
          'When a new Atlas version lands, an "atlas updated" pill appears in the footer — click it to reload into the new version. Hover the pill to see the Atlas commit you are on and the one you will get.',
          'An "update available" pill means a newer version of the app itself is ready — hover it to see the code version you are on and the one a reload will switch to, then click it to reload.',
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
  };
