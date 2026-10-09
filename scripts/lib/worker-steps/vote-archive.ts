// Executive titles older than the vote record (src/server/pau/vote-archive.ts):
// a few makerdao/community files per tick, each kept only when the chain shows
// its spell cast. The listing is fetched once; at three files a tick the whole
// archive takes about a day. A failure is this step's warning, never the run's.
const FILES_PER_TICK = Number(process.env.EXECUTIVE_ARCHIVE_FILES_PER_TICK ?? 3);

async function fetchOk(url: string): Promise<Response> {
  const { politeFetch } = await import("../../../src/lib/upstreamBackoff.ts");
  const res = await politeFetch(url, { headers: { "User-Agent": "redlens-atlas-worker" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export default {
  id: "vote-archive",
  phase: "tick" as const,
  label: "vote archive step",
  skipWhenNoFetch: "vote archive skipped (--no-fetch) — it reads GitHub",
  async run({ db }: { db: unknown }): Promise<string> {
    const { backfillArchive } = await import("../../../src/server/pau/vote-archive.ts");
    const deps = { fetchText: async (u: string) => (await fetchOk(u)).text(), fetchJson: async (u: string) => (await fetchOk(u)).json() };
    const r = await backfillArchive(db as Parameters<typeof backfillArchive>[0], deps, FILES_PER_TICK);
    const listed = r.listed ? `listed ${r.listed}, ` : "";
    return `vote archive: ${listed}${r.checked} checked, ${r.verified} verified, ${r.pending} pending`;
  },
};
