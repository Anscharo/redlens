// The primitive lifecycle the Primitives page opens with: activate, invoke,
// operate, complete. Each quote is a verbatim slice of the atlas document it
// cites, pinned by primitiveLifecycle.artifact.test.ts so an edit upstream
// fails the suite instead of leaving a misquote on the page. Documents are
// keyed by UUID; the title is display text, checked by the same test.

export interface LifecycleQuote {
  docId: string;
  /** The cited document's title, shown as the attribution. */
  docTitle: string;
  /** Verbatim from the document's content. */
  text: string;
  /** Where the quote stops short of the sentence: the start, the end, or both. */
  cut?: "start" | "end" | "both";
}

export interface LifecycleStep {
  /** The status the step ends in; the key of the pill that names it elsewhere on the page. */
  status: "Active" | "InProgress" | "Completed";
  /** "global" is a primitive's Global Activation Status; "instance" an instance's. */
  level: "global" | "invocation" | "instance";
  summary: string;
  quotes: LifecycleQuote[];
}

export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  {
    status: "Active",
    level: "global",
    summary: "An Agent first Globally Activates a Primitive.",
    quotes: [
      {
        docId: "dcd0bead-7ad1-4fe0-b485-b3565d670c78", // A.2.2.1.2.1
        docTitle: "Primitives Must First Be Activated To Be Invoked",
        text: "An Agent may only Invoke a Primitive that it has previously Globally Activated",
        cut: "end",
      },
    ],
  },
  {
    status: "InProgress",
    level: "invocation",
    summary: "It then Invokes the Primitive. The Invocation stays in progress until validated and voted on.",
    quotes: [
      {
        docId: "316daff4-3260-45da-afde-eea3d357b9eb", // A.2.2.1.4.2
        docTitle: "Required Inputs Into Sky Primitive",
        text: "To Invoke a Primitive, an Agent must supply all required inputs",
        cut: "end",
      },
      {
        docId: "a06c8e7a-e20f-459a-99e3-a62a5c0c4fd1", // A.2.2.1.4.4
        docTitle: "Token Holder Vote",
        text: "After the Primitive inputs have been validated, Agent token holders vote on whether to upgrade the Artifact with the Primitive(s).",
      },
    ],
  },
  {
    status: "Active",
    level: "instance",
    summary: "A successful vote creates an instance, which runs on its own status.",
    quotes: [
      {
        docId: "6948d758-ad79-47b8-8466-74c75ec9db9e", // A.2.2.1.4.5
        docTitle: "Formal Integration Of Primitives",
        text: "If the vote is successful, the Agent Artifact is officially upgraded with a Primitive Instance",
        cut: "end",
      },
      {
        docId: "dfd19e92-2660-4393-8dff-a3a7e4ad75ff", // A.2.2.1.3.2.1
        docTitle: "Active Instance Status",
        text: "an instance of a Primitive is fully operational and may be used for its intended purpose",
        cut: "both",
      },
    ],
  },
  {
    status: "Completed",
    level: "instance",
    summary: "An instance that has finished its work is Completed.",
    quotes: [
      {
        docId: "82b88f94-b83a-432a-bb8e-4e726535156a", // A.2.2.1.3.2.3
        docTitle: "Completed Instance Status",
        text: "an Instance of a Primitive has reached a terminal state",
        cut: "both",
      },
    ],
  },
];
