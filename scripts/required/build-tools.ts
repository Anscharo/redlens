// Extracts { name, desc } from the server's tool registry (the single source
// of truth for the atlas MCP/chat tool surface) so the /connect page's tool
// list can never drift from what's actually exposed — it used to be a
// hand-mirrored array in src/components/connectData.ts that silently went
// stale (missing atlas_first_seen after it shipped). Runs under bun: the
// registry and its dependents are TypeScript, and importing it never touches
// Postgres (constructing the lazy SQL client doesn't connect).
import fs from "node:fs";
import path from "node:path";
import { ATLAS_TOOLS } from "../../src/server/tool-registry.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const OUT = path.join(ROOT, "public", "tools.json");

const tools = ATLAS_TOOLS.map((t) => ({ name: t.name, desc: t.description })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

fs.writeFileSync(OUT, JSON.stringify(tools, null, 2));

console.log(`wrote ${OUT}: ${tools.length} tools`);
for (const t of tools.slice(0, 3)) console.log(`  - ${t.name}: ${t.desc.slice(0, 60)}…`);
