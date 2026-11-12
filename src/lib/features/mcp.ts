import type { FeatureGroup } from "../features-types.ts";

export const mcp: FeatureGroup = {
    key: "mcp",
    title: "Connect (MCP)",
    route: "/connect",
    blurb:
      "Connect your own AI assistant to the Atlas over MCP — tools for search, traversal, entities, history, and reports.",
    features: [
      {
        name: "Connecting a client",
        what: "Point Claude Code, Claude Desktop, Cursor/Windsurf, or any MCP client at the Atlas.",
        how: [
          "Open the Connect page and pick your client.",
          "Copy the setup snippet and paste it into your client's MCP configuration.",
          "Ask your assistant to search, traverse, look up an address, or pull a report — it cites the Atlas directly.",
          "Monthly settlement dollar questions use `external_msc` (Soter Labs workbooks / Sky Forum) — that tool is labeled not-Atlas.",
          "Ask what open Atlas pull requests propose — `atlas_open_prs` lists them, and the preview tools read the changes of any whose public preview has been built on the Preview page.",
          "The Connect page lists the live tool set, so it always matches what the server is actually serving.",
        ],
      },
    ],
  };
