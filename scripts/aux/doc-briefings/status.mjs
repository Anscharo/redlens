import { BRIEFING_MAX_FAILURES, countDiffering, planBriefings, pullBriefings } from "../../lib/doc-briefings.mjs";
import { ARTIFACT, atLimit, describe, flag, load, readDbRows, readJson, rel } from "./common.mjs";

/** `pnpm briefings:status`: what needs a description. */
export async function status() {
  const { nodes, layout, state, stale } = load();
  const full = stale || flag("full");
  const plan = planBriefings(nodes, state, { full });
  describe(plan, layout);
  const artifact = readJson(ARTIFACT, null);
  console.log(`described: ${artifact ? Object.keys(artifact.briefings ?? {}).length : 0} documents in ${rel(ARTIFACT)}`);
  console.log(`last pass: ${state.sweptAt ?? "never"} @ ${(state.atlasSha ?? "—").slice(0, 8)}`);
  // The database is the live record, so the file can be behind it. Never fatal:
  // a down database leaves the file-only output above.
  if (process.env.DATABASE_URL) {
    try {
      const rows = await readDbRows();
      const differing = countDiffering(artifact?.briefings ?? {}, pullBriefings(rows));
      console.log(`database: ${differing} rows newer than the file (run \`pnpm briefings:pull\`)`);
      console.log(`database: ${atLimit(rows)} rows at the failure limit (${BRIEFING_MAX_FAILURES})`);
    } catch (e) {
      console.log(`database: unreachable or no briefings table (${String(e?.message ?? e).split("\n")[0].slice(0, 80)})`);
    }
  }
  process.exit(0);
}
