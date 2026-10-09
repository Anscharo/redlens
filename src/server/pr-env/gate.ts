// The PR-environment gate. Railway forks one environment per pull request
// (`pr-<n>`) from the base environment, so each inherits the base's API keys and
// runs its own atlas worker against its own database. In such an environment the
// worker is INERT: it builds the checked-out atlas commit (no-fetch), skips every
// step and tail that calls an outside API, and copies the PAU and on-chain tables
// from the development database instead (copy.ts).
//
// Only an exact `pr-<n>` name turns it on. An unknown name stays live, because
// an inert production worker would stop advancing the atlas with no error, while
// a live PR environment only spends quota. PR_ENV_INERT=1 forces it on and
// PR_ENV_INERT=0 forces it off, whatever the name; unset defers to the name.
import { config } from "../config.ts";

const PR_ENV = /^pr-\d+$/;

export interface PrEnvGate {
  inert: boolean;
  /** The one-line startup report of which way the gate resolved, and why. */
  line: string;
}

/** Pure: the decision from the lowercased Railway environment name and the override. */
export function prEnvGate(railwayEnv: string, override: string | undefined): PrEnvGate {
  const forced = override === "1" ? true : override === "0" ? false : null;
  const inert = forced ?? PR_ENV.test(railwayEnv);
  const why = forced === null ? `env="${railwayEnv}"` : `PR_ENV_INERT=${override}, env="${railwayEnv}"`;
  const line = inert
    ? `PR-environment mode ON (${why}) — no-fetch build, no outside API calls, PAU and on-chain tables copied from PR_ENV_SOURCE_DATABASE_URL`
    : `PR-environment mode OFF (${why}) — live worker: fetches upstream and reads outside APIs`;
  return { inert, line };
}

/** The gate for this process, from config.railwayEnv and PR_ENV_INERT. */
export function currentPrEnvGate(env: NodeJS.ProcessEnv = process.env): PrEnvGate {
  return prEnvGate(config.railwayEnv, env.PR_ENV_INERT);
}
