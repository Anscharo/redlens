import type { FeatureGroup } from "../features-types.ts";

export const crossview: FeatureGroup = {
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
  };
