// The upstream_cooldown table as the back-off's store (src/lib/upstreamBackoff.ts),
// so a host that asked the worker to slow down stays left alone across runs.
import { useCooldownStore, type CooldownStore } from "../lib/upstreamBackoff.ts";
import type { SqlTag } from "./sql-types.ts";

export function dbCooldownStore(db: SqlTag): CooldownStore {
  return {
    async load() {
      const rows = (await db`SELECT host, until FROM upstream_cooldown WHERE until > now()`) as { host: string; until: Date | string }[];
      return rows.map((r) => ({ host: r.host, until: new Date(r.until).getTime() }));
    },
    async save(host, until) {
      await db`
        INSERT INTO upstream_cooldown (host, until) VALUES (${host}, ${new Date(until)})
        ON CONFLICT (host) DO UPDATE SET until = GREATEST(upstream_cooldown.until, excluded.until)`;
    },
  };
}

/** Loads and saves cooldowns through `db` for the rest of this process. */
export const useDbCooldowns = (db: SqlTag) => useCooldownStore(dbCooldownStore(db));
