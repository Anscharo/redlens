// Labeled cases for the quote-attribution lane (CHAT_QUOTE_ATTRIBUTION_MODEL).
//
// `expected` is what the lane should answer: true = the answer is presenting
// this span as wording taken from a source, false = the span is the assistant's
// own words. The ERROR DIRECTIONS ARE NOT SYMMETRIC, and the asymmetry is the
// whole reason this lane exists:
//   - a false TRUE on a self-authored callout hard-fails an honest answer and
//     shows the reader a red badge. DANGEROUS.
//   - a false FALSE on a real quotation lets one unattributed invented passage
//     through to the model auditors, which still see the answer. Tolerable.
// So the operating point is fitted from the dangerous side: the LOWEST margin at
// which no `expected: false` case is promoted.
//
// `hard: true` marks a case written to be adversarial for the regex this lane
// replaced (`isSelfAuthoredCallout`, which needed ~90% of the line to be bold).
// `incident: true` marks a case observed in production — those must never
// regress, whatever a future bakeoff says about the margin.

export interface QuoteCase {
  leadIn: string;
  passage: string;
  expected: boolean;
  hard?: boolean;
  incident?: boolean;
  note?: string;
}

// The 2026-10-01 churn answer: three plain-prose callouts, all three scored as
// invented atlas text, all three hard-failing the turn. `isSelfAuthoredCallout`
// missed every one because none of them is bold.
const INCIDENTS: QuoteCase[] = [
  {
    leadIn: "The practical lesson is:",
    passage: "Treat a changed document number as a label change until the body digest moves as well.",
    expected: false, hard: true, incident: true,
  },
  {
    leadIn: "But it has an important practical consequence:",
    passage: "A renumbering inside one bucket file produces no history event at all, so a stale fork shows phantom changes.",
    expected: false, hard: true, incident: true,
  },
  {
    leadIn: "The central conclusion is:",
    passage: "Most of what looks like churn in the atlas is editorial relabelling rather than substantive change.",
    expected: false, hard: true, incident: true,
  },
];

// Self-authored callouts in the shapes models actually write them.
const CALLOUTS: QuoteCase[] = [
  { leadIn: "Bottom line:", passage: "The Stability Scope owns the rates; the Support Scope owns the people who change them.", expected: false },
  { leadIn: "In short:", passage: "Two different documents answer two different halves of your question, and neither answers both.", expected: false },
  { leadIn: "My read of the above:", passage: "The threshold is procedural rather than a hard technical constraint on the multisig itself.", expected: false },
  { leadIn: "So, to summarise what the documents above add up to:", passage: "Nothing in the atlas assigns this responsibility to a single named actor.", expected: false, hard: true },
  { leadIn: "What this means in practice:", passage: "You will need to read both the Scope article and its Annotations to get the whole rule.", expected: false },
  { leadIn: "The upshot for your question:", passage: "The figure you are after is derived, not stated anywhere as a single number.", expected: false },
  { leadIn: "A caveat worth stating plainly:", passage: "This is our parse of the atlas documents, not a quotation from any one of them.", expected: false, hard: true },
  { leadIn: "Here is a worked example of how the formula applies:", passage: "A facility holding 10,000,000 USDS at a 5% rate accrues 500,000 USDS over a year.", expected: false, hard: true },
  { leadIn: "Rephrasing the rule in plainer language:", passage: "Anyone who can move funds has to be named in advance, and the naming has to be published.", expected: false, hard: true },
  { leadIn: "One recommendation before you act on this:", passage: "Confirm the current signer set on chain rather than relying on the atlas snapshot.", expected: false },
  // Mentions a document without claiming the passage is its wording — the
  // use-vs-mention case tier A deliberately refuses to settle in code.
  { leadIn: "A.1.7.1 covers Operational Facilitators in some detail.", passage: "They are the actors who carry out day-to-day operational decisions on behalf of a Scope.", expected: false, hard: true },
  { leadIn: "The Governance Scope is the relevant place to look here.", passage: "In our reading, that makes the Governance Scope the ultimate authority for this decision.", expected: false, hard: true },
  // An absence claim: the span cannot be in the source, and saying so is the
  // most honest thing the answer can do.
  { leadIn: "The atlas does not define anything called:", passage: "an Operational Risk Facilitator with independent treasury authority", expected: false, hard: true },
  { leadIn: "You can ask things like:", passage: "Which rules govern an integrator reward, and who approves it?", expected: false },
  // A greeting-shaped answer that happens to contain a set-apart line.
  { leadIn: "Happy to help — here is how I would frame it:", passage: "Start from the Scope, then follow its Articles down to the Core documents.", expected: false },
];

// Genuine attributions. These are what the lane must keep catching, because an
// unmatched span under one of them is a real misquotation.
const ATTRIBUTED: QuoteCase[] = [
  { leadIn: "A.2.4.1 states:", passage: "The Facilitator must approve each disbursement before it is executed.", expected: true },
  { leadIn: "[Distribution Reward Rate](/atlas/0a1b2c3d-0000-0000-0000-000000000000) states:", passage: "The standard Distribution Reward rate is set at 0.2%.", expected: true },
  { leadIn: "The atlas says:", passage: "A Scope may delegate its authority only to an actor it has itself recognised.", expected: true },
  { leadIn: "Quoting the Scope directly:", passage: "No Facilitator may unilaterally alter a parameter outside its own Scope.", expected: true },
  { leadIn: "The text reads:", passage: "Each Active Data entry must name the actor responsible for maintaining it.", expected: true },
  { leadIn: "Per the Threshold Requirements:", passage: "At least seven signers are required for any treasury movement.", expected: true },
  { leadIn: "The relevant Article puts it this way:", passage: "Recognition is granted by resolution and withdrawn the same way.", expected: true, hard: true },
  { leadIn: "Verbatim from the Preamble:", passage: "The Atlas is the single source of governance truth for the ecosystem.", expected: true },
  { leadIn: "According to A.3.2:", passage: "The Stability Scope sets the protocol rates for all instances.", expected: true },
  { leadIn: "The definition given is:", passage: "An Operational Facilitator is an actor appointed to execute a Scope's routine decisions.", expected: true },
  { leadIn: "It is listed as:", passage: "Chronicle Point Reward Instance — the Ethereum mainnet reward mechanism.", expected: true },
  { leadIn: "The prohibition is stated as:", passage: "A party to an Accord may not also adjudicate a dispute arising under it.", expected: true },
  // Attribution AFTER the span, which is how models often close a blockquote.
  { leadIn: "— [Stability Scope](/atlas/0a1b2c3d-0000-0000-0000-000000000000) (A.3.1)", passage: "The Stability Scope governs the protocol rates for all instances.", expected: true, hard: true },
  // No citation at all, but unmistakably claiming to quote — the class tier A
  // cannot catch (nothing to cite) and the lane must.
  { leadIn: "The document says, word for word:", passage: "Any change to a recognised actor's mandate takes effect at the next cycle boundary.", expected: true, hard: true },
  { leadIn: "In its own words:", passage: "The Support Scope exists to serve the other Scopes, not to direct them.", expected: true, hard: true },
];

export const CASES: QuoteCase[] = [...INCIDENTS, ...CALLOUTS, ...ATTRIBUTED];

/**
 * Split for fitting vs reporting: alternate within each class so both halves
 * carry the same mix of positives, negatives and hard cases. Fitting a margin
 * and reporting it on the same cases is how a lane ships an in-sample number —
 * refute-screen.ts's threshold is explicitly marked in-sample for that reason.
 */
export function splitCases(cases: QuoteCase[] = CASES): { fit: QuoteCase[]; held: QuoteCase[] } {
  const fit: QuoteCase[] = [];
  const held: QuoteCase[] = [];
  const seen = { true: 0, false: 0 };
  for (const c of cases) {
    const key = String(c.expected) as "true" | "false";
    (seen[key]++ % 2 === 0 ? fit : held).push(c);
  }
  return { fit, held };
}
