// Shared type-only definitions for the chat widget. Colocated here (rather than
// declared in ChatWidget.tsx) so ChatWidget and ChatPanel don't form a type-only
// import cycle between each other.
export type Placement = "float" | "anchored";
