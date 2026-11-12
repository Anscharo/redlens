// Who can change a Solana limit (an svm deployment, src/server/pau/svm-snapshot.ts).
// The program has no Configurator and no BeamState, so there is no Operator
// route: only an account whose Permission grants the Default Admin Role may set
// a Reserve's or an Integration's limit, and Keel's is the Keel SubProxy's CPI
// authority, which signs only for a LayerZero governance message the SubProxy
// sent, which only a spell can make it send. The admins are the active admin
// Permissions' holders, read from the deployment's `permission` contracts (the
// limits' own contract holds no roles). Only the prime's known CPI authority is
// the spell's route; any other active admin is a key that can set the limit
// directly, and is named as that, with no citation. Each claim cites the atlas
// document it rests on, by UUID; their doc_nos are looked up, never kept. Pure.
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { KeyRoutes } from "./pauKeyRoutes.ts";

/** The atlas documents a prime's Solana route rests on, by prime entity UUID. */
export const SVM_ROUTE_DOCS: Record<string, { authority: string; admin: string; reserve: string; integration: string; whitelist: string }> = {
  // Keel
  "bc6aed17-2969-4d04-9af6-c7bf3e4497e6": {
    /** The Keel SubProxy's CPI authority on Solana, which signs what the LayerZero governance program relays. */
    authority: "FDFsoboECfazAq1eLvwBLZXhoxjPvTy4wCzPdbqnk7Zk",
    /** Default Admin Role: fully controlled by Sky Governance via the Keel SubProxy. */
    admin: "0270b595-8957-4fb2-a9cd-2bc197dc3367",
    /** Only the Default Admin Role sets a Reserve's rate limit (manage_reserves). */
    reserve: "aa43f1e6-6ee6-4596-a288-f79685cd8144",
    /** Only the Default Admin Role sets an Integration's rate limit (manage_integration). */
    integration: "62654961-cf70-4455-a7df-c81861944395",
    /** The Keel SubProxy is authorized to send cross-chain messages to Solana. */
    whitelist: "b319a7e6-d484-44e7-b622-6df9754c5973",
  },
};

/** Whether the check's limit lives on a Reserve (else an Integration: a swap, a bridge or an instance). */
const onReserve = (c: ValueCheck) => (c.limit?.svm ? c.limit.svm.account === "reserve" : !!c.key?.startsWith("reserve:"));

/** The holders of an active Default Admin Role Permission on the check's deployment, as written on chain. */
function svmAdmins(c: ValueCheck, snaps: readonly StoredPauSnapshot[]): string[] {
  const deps = snaps.filter((s) => s.chain === c.chain && (!c.kind || s.kind === c.kind));
  const perms = deps.flatMap((s) => s.contracts.filter((x) => x.role === "permission"));
  return [...new Set(perms.flatMap((p) => (p.roles ?? []).filter((r) => r.name === "DEFAULT_ADMIN_ROLE" && r.holds !== false).map((r) => r.account)))];
}

/** Who can change a Solana limit: a spell, relayed over LayerZero governance to the prime's CPI authority while it is an admin, and any other admin directly; null when no admin is read. */
export function svmKeyRoutes(c: ValueCheck, snaps: readonly StoredPauSnapshot[], docNo?: (uuid: string) => string | null): KeyRoutes | null {
  const admins = svmAdmins(c, snaps);
  if (admins.length === 0) return null;
  const prime = snaps.find((s) => s.chain === c.chain)?.prime;
  const docs = prime ? SVM_ROUTE_DOCS[prime] : undefined;
  const relayed = admins.filter((a) => a === docs?.authority);
  const direct = admins.filter((a) => a !== docs?.authority);
  const uuids = docs && relayed.length ? [onReserve(c) ? docs.reserve : docs.integration, docs.admin, docs.whitelist] : [];
  const cites = docNo ? uuids.map(docNo).filter((d): d is string => !!d) : [];
  return { admins: relayed, operator: null, relay: { via: "layerzero", ...(cites.length ? { cites } : {}), ...(direct.length ? { direct } : {}) } };
}
