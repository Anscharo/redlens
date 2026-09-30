// preview_vectors (src/server/preview/vector-cache.ts) against the REAL
// Postgres, inside a transaction that is rolled back, so nothing it writes
// remains. The unit tests stub the database; this is the one place the three
// queries run for real — a reversed sort in the eviction query would drop the
// NEWEST rows and no stub would notice.
//
//   bun scripts/aux/preview-vectors-check.ts      needs DATABASE_URL, migrations applied
//
// Off the `pnpm build` chain.
import { sql } from "../../src/server/db.ts";
import { evictVectors, readVectors, saveVectors } from "../../src/server/preview/vector-cache.ts";

const vec = (x: number) => { const v = new Array(1024).fill(0); v[0] = x; return v; };
class Rollback extends Error {}
try {
  await sql.begin(async (tx: any) => {
    const M = "test-model";
    await saveVectors([["h1", vec(1)], ["h2", vec(2)], ["h3", vec(3)], ["h4", vec(4)]], tx, M);
    // Make them the oldest rows in the table, h1 oldest.
    for (const [h, y] of [["h1", 2001], ["h2", 2002], ["h3", 2003], ["h4", 2004]] as const) await tx`UPDATE preview_vectors SET last_used = ${`${y}-01-01`}::timestamptz WHERE model = ${M} AND content_hash = ${h}`;
    const total = ((await tx`SELECT count(*)::int AS n FROM preview_vectors`) as any[])[0].n;
    console.log(`rows in table: ${total} (4 are this test's)`);

    // READ: returns the vectors, and marks what it read as used.
    const got = await readVectors(["h2", "h3", "nope"], tx, M);
    console.log(`read h2,h3,nope -> ${[...got.keys()].sort().join(",")}; h2[0]=${got.get("h2")?.[0]}, length ${got.get("h2")?.length}`);
    const after = (await tx`SELECT content_hash, last_used > now() - interval '1 minute' AS fresh FROM preview_vectors WHERE model = ${M} ORDER BY content_hash`) as any[];
    console.log(`marked as used: ${after.map((r) => `${r.content_hash}=${r.fresh}`).join(" ")}`);

    // Another model's vector for the same hash is not returned.
    console.log(`read under another model -> ${(await readVectors(["h2"], tx, "other-model")).size} rows`);

    // A live-atlas hash is found too, without being kept here.
    const live = ((await tx`SELECT content_hash FROM atlas_doc_embeddings LIMIT 1`) as any[])[0].content_hash;
    console.log(`read a live atlas hash -> ${(await readVectors([live], tx, M)).size} row`);

    // SAVE again: an existing hash is only marked as used, the vector is kept.
    await saveVectors([["h1", vec(9)]], tx, M);
    const h1 = ((await tx`SELECT embedding::text AS v, last_used > now() - interval '1 minute' AS fresh FROM preview_vectors WHERE model = ${M} AND content_hash = 'h1'`) as any[])[0];
    console.log(`save h1 again -> first value still ${JSON.parse(h1.v)[0]}, marked as used ${h1.fresh}`);

    // EVICT: cap at two fewer than the table holds. The two least recently
    // used rows are h4 (2004) and ... h1,h2,h3 were all just used, so h4 goes
    // first, then the oldest real row.
    const gone = await evictVectors(tx, total - 1);
    const left = (await tx`SELECT content_hash FROM preview_vectors WHERE model = ${M} ORDER BY content_hash`) as any[];
    console.log(`evict with cap ${total - 1} -> removed ${gone}; test rows left: ${left.map((r) => r.content_hash).join(",")}`);
    const none = await evictVectors(tx, 1_000_000);
    console.log(`evict under the cap -> removed ${none}`);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}
const n = ((await sql`SELECT count(*)::int AS n FROM preview_vectors WHERE model = 'test-model'`) as any[])[0].n;
console.log(`after rollback, test rows in table: ${n}`);
await sql.end();
