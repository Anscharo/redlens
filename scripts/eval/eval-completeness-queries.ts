// Labeled set for class-completeness tool choice (docs/plans/chat-class-completeness.md
// Phase 4). Every positive is a question whose answer is NOT in a typical top-10
// "rate limit" / "oldest" search: the 2026-08-24 incident and paraphrases.
export interface CompletenessQuery {
  id: string;
  q: string;
  kind: "extremum" | "listing" | "needle";
}

export const INCIDENT_UUID = "8414b48b-932e-430e-a236-727807fd73ba";

export const COMPLETENESS_QUERIES: CompletenessQuery[] = [
  {
    id: "incident-oldest-rate-limit",
    q: "What is the oldest rate limit id in the atlas.",
    kind: "extremum",
  },
  {
    id: "oldest-rate-limit-paraphrase",
    q: "Which Rate Limit document was first-seen in atlas history?",
    kind: "extremum",
  },
  {
    id: "oldest-modified-rate-limit",
    q: "What is the oldest non-move edit among Rate Limit docs?",
    kind: "extremum",
  },
  {
    id: "all-rate-limit-ids",
    q: "What are all rate limit ids in the atlas?",
    kind: "listing",
  },
  {
    id: "how-many-rate-limits",
    q: "How many documents are titled Rate Limit?",
    kind: "listing",
  },
  {
    id: "exact-title-needle",
    q: "Find the document whose exact title is Rate Limit and tell me the oldest one.",
    kind: "needle",
  },
];
