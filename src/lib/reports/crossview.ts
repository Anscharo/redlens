import type { ReportMeta } from "./types";

export const crossview = {
  id: "crossview",
  title: "Atlas CrossView",
  description:
    "The Atlas as functional chunks: hierarchical weight maps of scopes, agent artifacts, and primitives, a cross-cutting concept catalog with its audit trail, and the glossary of defined terms.",
  group: "structure",
  provenance: "live",
} as const satisfies ReportMeta;
