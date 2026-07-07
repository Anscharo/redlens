const ARTICLES_AND_PREPOSITIONS_AND_CONJUNCTIONS =
  /\b(the|a|of|an|and|or|for|in|on|to|at|by|with|from)\b/gi;

const ABBREVIATIONS: Record<string, string> = {
  directory: "Dir.",
  directories: "Dirs.",
  document: "Doc.",
  documents: "Docs.",
  configuration: "Config.",
  configurations: "Configs.",
  specification: "Spec.",
  specifications: "Specs.",
  controller: "Ctrl.",
  controllers: "Ctrls.",
  primitives: "Prims.",
  primitive: "Prim.",
  instances: "Inst.",
  instance: "Inst.",
  artifacts: "Artfcts.",
  properties: "Props.",
  property: "Prop.",
  governance: "Gov.",
  definition: "Def.",
  definitions: "Defs.",
  ecosystem: "Eco.",
  implementation: "Impl.",
  implementations: "Impls.",
  transformation: "Xform.",
  transformations: "Xforms.",
  transitionary: "Trans.",
  customizations: "Customs.",
  customization: "Custom.",
  accessibility: "A11y.",
  reimbursement: "Reimb.",
  communication: "Comms.",
  communications: "Comms.",
  responsibilities: "Resps.",
  responsibility: "Resp.",
  authorization: "Auth.",
  infrastructure: "Infra.",
  determination: "Determ.",
  administrative: "Admin.",
  accountability: "Acctbl.",
  reconciliation: "Recon.",
  documentation: "Docs.",
  identification: "Ident.",
  interpolation: "Interp.",
  participation: "Partic.",
  representation: "Rep.",
  classification: "Class.",
  incorporation: "Incorp.",
  consolidation: "Consol.",
  qualification: "Qual.",
  organizational: "Org.",
  comprehensive: "Compr.",
  bootstrapping: "Bootstrap.",
  distribution: "Distrib.",
  management: "Mgmt.",
  operational: "Oper.",
  parameters: "Params.",
  parameter: "Param.",
  collateral: "Collat.",
  foundation: "Fndn.",
  information: "Info.",
  transaction: "Txn.",
  transactions: "Txns.",
  integration: "Integ.",
  integrations: "Integs.",
  requirements: "Reqs.",
  requirement: "Req.",
  environment: "Env.",
  application: "App.",
  applications: "Apps.",
  verification: "Verif.",
  notification: "Notif.",
  notifications: "Notifs.",
};

// Densify freeform prose (e.g. a search snippet) using the same vocabulary as
// the breadcrumb title shortener: drop articles/prepositions/conjunctions and
// abbreviate every known long word. No char cap — the caller controls length.
// More content words per byte, which is the whole point for MCP snippets.
export function compactProse(text: string): string {
  return text
    .replace(/\bEthereum Mainnet\b/gi, "Ethereum")
    .replace(ARTICLES_AND_PREPOSITIONS_AND_CONJUNCTIONS, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(" ")
    .map((w) => ABBREVIATIONS[w.toLowerCase()] ?? w)
    .join(" ");
}

export function shortenTitle(title: string, maxChars: number, abbrRatio = 0.5): string {
  let t = title
    .replace(/\bEthereum Mainnet\b/gi, "Ethereum")
    .replace(ARTICLES_AND_PREPOSITIONS_AND_CONJUNCTIONS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = t.split(" ");
  const maxAbbrev = Math.max(1, Math.floor(words.length * abbrRatio));
  let abbrCount = 0;
  const candidates = words
    .map((w, i) => ({ i, w, abbr: ABBREVIATIONS[w.toLowerCase()] }))
    .filter((c) => c.abbr)
    .sort((a, b) => b.w.length - a.w.length);
  for (const c of candidates) {
    if (abbrCount >= maxAbbrev) break;
    words[c.i] = c.abbr;
    abbrCount++;
  }
  t = words.join(" ");
  if (t.length > maxChars) {
    t = t.slice(0, maxChars - 1) + "…";
  }
  return t;
}
