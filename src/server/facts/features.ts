// The product-documentation fact: when the question is about what can be DONE
// here rather than what the atlas SAYS, inject the Features guide
// (src/lib/featuresData.ts — the app's single source of truth for "what
// can this app do", the same data /features renders) so the answer describes
// the real app instead of the model's guess at one.
//
// Two distinctions this fact exists to enforce, both carried in NOTE and
// VOCABULARY below and both easy to get wrong without them:
//   1. THIS CHAT vs THE WEB APP — what the assistant can do in the panel is not
//      what the person can do in the browser. Answering one for the other is
//      the failure mode ("I can show you the report" when the user has to open
//      it themselves, or vice versa).
//   2. THE ATLAS vs OUR EXTRACTION — the atlas is the source documents;
//      entities, relations, addresses, params, censuses and every report built
//      on them are RedLens's parse of those documents, not atlas text.
import { FEATURE_GROUPS, type FeatureGroup } from "../../lib/featuresData.ts";
import type { Fact, FactBlock, FactContext } from "./types.ts";

// `how` steps are ~60% of the guide's bulk. Every area ships its name/what/note
// (breadth — "what can I do here"); only the areas the question actually names
// ship their steps (depth — "how do I export a CSV").
const MAX_DETAIL_GROUPS = 3;

// Phrasings that ask about the product on their own. The negative lookahead on
// the first is load-bearing: "what can I do to become a facilitator" and "what
// can I do about the deficit" are governance questions wearing this shape.
// `with` is handled separately (DO_WITH below) — the old `with the atlas`
// lookahead still let "what can I do with the Stability Scope" through.
const DIRECT: RegExp[] = [
  /\bwhat (can|could) (i|you|we|users?) (do|see|ask)\b(?!\s+(to|about|if|when|before|after|for)\b)/i,
  /\bwhat (can|does) (this app|the app|this site|this tool|redlens?|redline(?: sky)? atlas|you) (do|offer|support|provide)\b/i,
  /\bwhat (features?|capabilit(y|ies)|functionalit(y|ies)) (exist|are there|are available|do you have|does it have)\b/i,
  /\bwhat (is|are) (redlens?|redline(?: sky)? atlas|this app|this site|this tool)\b/i,
  /\bhow do i (use|get started with|navigate) (this|the app|redlens?)\b/i,
  /\bwhat else can (you|i)\b/i,
];

// "what can I do with X" is product only when X is the app (or a UI artifact).
// Without this gate DIRECT[0] fires on any "with", including atlas objects.
const DO_WITH = /\bwhat (can|could) (i|you|we|users?) (do|see|ask)\s+with\b/i;

// Capability vocabulary is only about the product when it points at the
// product: "what are the features of the Stability Scope" must stay an atlas
// question, so a bare "features" never fires this fact.
const CAPABILITY = /\b(features?|capabilit(y|ies)|functionalit(y|ies)|capable of|what you can do)\b/i;
const APP_REF = /\b(app|application|site|website|platform|tool|redlens?|redline|chat|assistant|you|your|here)\b/i;

// "How do I …" is the other half of a capability question, and the half the
// `how` steps exist for. It needs an object that only exists in the UI —
// "how do i find the stability rate" is an atlas question with the same shape.
const HOW_TO = /\b(how (do|can) i|where (do|can) i|where is|can i)\b/i;
const APP_ARTIFACT =
  /\b(csv|exports?|downloads?|buttons?|pages?|tabs?|panels?|sidebars?|shortcuts?|keyboard|bookmarks?|urls?|links?|filters?|columns?|toggles?|dark mode|themes?|sign(ing)? in|accounts?|collections?|mcp|previews?|radar|reports?)\b/i;

// Example questions for the registry's similarity lane (facts/similarity.ts),
// which catches the phrasings no regex anticipates — "show me around", "what
// should i try first?". Kept here, next to the deterministic trigger, because
// they describe the same intent; the bakeoff imports these rather than keeping
// its own copy, so eval and production cannot drift.
export const FEATURES_PROTOTYPES = [
  "what can this app do?",
  "what features does this site have?",
  "how do i use this tool?",
  "what can you do?",
  "show me around the app",
  "how do i export data from a page?",
  "where do i click to change a setting?",
  "what is this website for?",
];

export function matchesFeaturesQuestion(question: string): boolean {
  // Same objects CAPABILITY / HOW_TO already require: an app pointer, not a
  // bare "with <atlas noun>". Checked first so DIRECT[0] cannot take the hole.
  if (DO_WITH.test(question)) return APP_REF.test(question) || APP_ARTIFACT.test(question);
  if (DIRECT.some((re) => re.test(question))) return true;
  if (CAPABILITY.test(question) && APP_REF.test(question)) return true;
  return HOW_TO.test(question) && APP_ARTIFACT.test(question);
}

// Which areas the question names — same shape as the census lane's signature
// table (concepts-prefetch.ts). An area with no signature simply never gets its
// `how` steps injected; it still ships breadth, so a new group added upstream
// degrades gracefully rather than breaking.
const GROUP_SIGNATURES: [string, RegExp][] = [
  ["reader", /\breader\b|\breading\b|\btree\b|\bannotations?\b|\bdocument view\b|\bhistor(y|ies)\b/i],
  ["search", /\bsearch|\bquer(y|ies)\b|\bfilters?\b|\bfind\b/i],
  ["radar", /\bradar\b|\bentit(y|ies)\b|\bactors?\b/i],
  ["reports", /\breports?\b|\bcsv\b|\bexports?\b|\btables?\b/i],
  ["crossview", /\bcross[- ]?view\b|\bconcepts?\b|\bglossar(y|ies)\b|\baudit\b/i],
  ["preview", /\bpreview\b|\bpull requests?\b|\bPR\b|\bbranch(es)?\b|\bforks?\b/i],
  ["mcp", /\bmcp\b|\bconnect\b|\bclaude\b|\bcursor\b|\bapi\b/i],
  ["platform", /\bsign(ing)? in\b|\baccounts?\b|\bcollections?\b|\bkeyboard\b|\bshortcuts?\b|\bthemes?\b/i],
];

function detailGroups(question: string): Set<string> {
  return new Set(
    GROUP_SIGNATURES.filter(([, re]) => re.test(question))
      .map(([key]) => key)
      .slice(0, MAX_DETAIL_GROUPS),
  );
}

// featuresData's `key` is a public /features#<key> anchor, so it is stable
// enough to key on — renaming one is already a breaking change upstream.
const UPCOMING_KEY = "upcoming";

const NOTE =
  "RedLens product documentation — how this app works — injected because the question asks what can be done here. " +
  "It is NOT atlas text: never cite an atlas document for it, and never say the Atlas states it. " +
  "Keep the two halves apart and name which one you are answering about: `chat` is what YOU, in this panel, can do; " +
  "`app` is what the person does themselves in the RedLens web app, by going somewhere and clicking. When both apply, say both. " +
  "Link an app area as an ordinary markdown link to its `where` route (e.g. [Reports](/reports)) — those are app pages, not " +
  "documents, so they never belong in a citation definition block. " +
  "`available: false` marks an area that is not switched on yet: describe it as planned, never as something to use today. " +
  "One exception to that: the catalog may still list this chat as upcoming, but you are plainly running — describe yourself from `chat`. " +
  "Use `vocabulary` whenever you say where an answer came from.";

const VOCABULARY = {
  the_atlas:
    "The Sky Atlas itself — the governance documents this app reads. Authoritative: quotes and citations come from here and nowhere else.",
  our_extraction:
    "Everything RedLens derives from those documents: the entity/relation graph, roles, on-chain addresses, parameters, censuses, " +
    "and every report and view built on them. It is our parse of the atlas text, not atlas text — attribute it as ours " +
    "(\"our extraction shows…\", \"our graph links…\") and never present a derived label, count, or relation as something the Atlas states.",
};

// What the assistant itself can do. Hand-written on purpose: the tool registry
// is the machine handle list, and tool names are never user-facing (see the
// system prompt's slug rule), so this describes capabilities in the words a
// user would use. Add a chat capability, add a line here.
const CHAT = {
  what_i_am:
    "The assistant in the RedLens chat panel. I read the Sky Atlas and RedLens's extracted graph through tools and answer with citations. " +
    "I am part of the app, but I am not the app.",
  i_can: [
    "Search and read atlas documents, quote them, and link the exact document.",
    "Walk the extracted graph: entities, their relations and roles, parameters, on-chain addresses.",
    "Pull the same curated rollups the report pages are built from.",
    "Answer from document history — what changed, when, and at which atlas version.",
    "Use the page you are on: ask about \"this document\" or \"this report\" and I take it from there.",
    "Hand back a file when you ask me to export what I found.",
  ],
  i_cannot: [
    "Change anything — not the Atlas, not the app, not your collections, not on-chain state.",
    "Read the web, or any source outside the Atlas and RedLens's own data.",
    "See your screen or click for you: everything under `app` is something you do in the browser.",
    "Rule on governance — I report what the Atlas says; facilitators and governance decide.",
  ],
};

function shapeGroup(g: FeatureGroup, detailed: boolean) {
  return {
    area: g.title,
    where: g.route ?? g.href ?? null,
    about: g.blurb,
    ...(g.key === UPCOMING_KEY ? { available: false } : {}),
    features: g.features.map((f) => ({
      name: f.name,
      what: f.what,
      ...(detailed ? { how: f.how } : {}),
      ...(f.note ? { note: f.note } : {}),
    })),
  };
}

export const featuresFact: Fact = {
  id: "features",
  what: "RedLens product documentation (the /features guide) for questions about what the app or this chat can do.",
  // Count is areas, which means nothing to a reader — name the thing instead.
  summarize: () => "the app's features guide",
  prototypes: FEATURES_PROTOTYPES,
  run({ question, page, semanticHit }: FactContext): FactBlock | null {
    // Three ways in: the deterministic trigger, the registry's similarity lane
    // (phrasings the trigger never anticipated), and being ON the features
    // page — itself the question, for a follow-up like "what does this cover?"
    // that names nothing.
    if (!matchesFeaturesQuestion(question) && !semanticHit && page?.path !== "/features") return null;
    const detailed = detailGroups(question);
    return {
      key: "app_features",
      note: NOTE,
      count: FEATURE_GROUPS.length,
      value: {
        vocabulary: VOCABULARY,
        chat: CHAT,
        app: FEATURE_GROUPS.map((g) => shapeGroup(g, detailed.has(g.key))),
      },
    };
  },
};
