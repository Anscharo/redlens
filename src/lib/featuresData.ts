// Feature catalog for the /features guide page. Data only — FeaturesPage.tsx
// renders it. Lives in src/lib (not src/components) because the SERVER reads it
// too: the chat's product-documentation fact imports it, and the runtime image
// copies src/lib but not src/components. Keep each `how` entry a short, concrete usage step naming the
// real control the user has to find.
//
// This file is the ordered list. Each group's wording lives in src/lib/features/<key>.ts
// so the catalog stays within the file size limit. Ship a user-visible feature by editing
// that group's file (see CLAUDE.md).
//
// The chat's product-documentation fact (src/server/facts/features.ts) injects this data
// verbatim when someone asks what the app can do, so anything stale here is stale in the
// chat's answers too.
//
// Accuracy rules, learned the hard way:
//   - Never hardcode a count that the app derives elsewhere (reports, MCP
//     tools). Counts drift the day after they ship; the /connect page reads
//     the tool count live, and reportCatalog.ts owns the report list.
//   - Sign-in providers are per-environment (authProviders()). Production
//     offers GitHub; say "sign in", not a fixed provider pair.
//   - Gesture copy must match src/lib/hintText.ts, which is what the footer
//     hint actually says when the user hovers the same control.

export type { Feature, FeatureGroup } from "./features-types.ts";

import { chat } from "./features/chat.ts";
import { crossview } from "./features/crossview.ts";
import { mcp } from "./features/mcp.ts";
import { platform } from "./features/platform.ts";
import { preview } from "./features/preview.ts";
import { radar } from "./features/radar.ts";
import { reader } from "./features/reader.ts";
import { reports } from "./features/reports.ts";
import { search } from "./features/search.ts";

export const FEATURE_GROUPS = [reader, search, radar, reports, crossview, preview, chat, mcp, platform];
