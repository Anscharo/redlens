// The PAU values audit report's rows: every atlas-stated PAU value, controller
// wiring and atlas role claim that needs an expert's attention, grouped by why
// (pauAudit.ts). A value checked on several deployments or keys is one row each;
// an item is one value, one controller or one rejected claim, and the report
// counts items. Pure.
import type { StoredPauSnapshot } from "./pau.ts";
import { AUDIT_GROUPS, AUDIT_REASONS, checkReason, type AuditGroup, type AuditReason } from "./pauAudit.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { HistoryEntry } from "./history.ts";
import { onchainStep, type OnchainStep, type PendingContext } from "./pauPending.ts";
import { deploymentsOf, operatorAdjustable } from "./pauPendingEvidence.ts";
import { valueChangedAt } from "./pauValueDate.ts";
import { checkChainValue } from "./pauCheckValue.ts";
import type { PauIgnored } from "./pauRegistry.ts";
import { controllerWiring } from "./pauWiring.ts";

export interface AuditRow {
  /** One value, controller or claim; several rows can share it. */
  item: string;
  group: AuditGroup;
  reason: AuditReason;
  /** Why, in a sentence: the reason's text, or the registry's own for a rejected claim. */
  note: string;
  primeId: string | null;
  prime: string;
  chain: string;
  kind: string | null;
  /** The instance, or the PAU part the row is about. */
  subject: string;
  /** The value ("Inflow slope") or the role. */
  label: string;
  stated: string;
  onchain: string;
  /** The atlas document stating it. */
  docId: string | null;
  key: string | null;
  contract: string | null;
  chainSetAt: string | null;
  atlasChangedAt: string | null;
  /** What the row's placing rests on, from the PAU history: the step still expected, or the spell that changed the deployment since without it. */
  step: OnchainStep | null;
}

export interface PrimeChecks {
  primeId: string;
  prime: string;
  checks: ValueCheck[];
}

/** An amount's whole part with thousands separators, as the atlas writes it ("20,000,000 USDC"). */
export const groupDigits = (s: string): string => s.replace(/^\d+/, (n) => BigInt(n).toLocaleString("en-US"));

/** What the chain holds for a checked value, in the atlas's own style. */
const onchainText = (c: ValueCheck): string => (c.status === "not-set" ? "never set" : c.limit ? groupDigits(checkChainValue(c)) : "");

const DATED = new Set<ValueCheck["status"]>(["mismatch", "not-set"]);

/** The atlas documents whose history places an item: those stating a mismatch or a limit never set. */
export const docsToDate = (primes: PrimeChecks[]): string[] => [...new Set(primes.flatMap((p) => p.checks.filter((c) => DATED.has(c.status)).map((c) => c.docId)))];

/** The vote record, the PAU history and today, for what a row says of the on-chain step. */
export type AuditVotes = Omit<PendingContext, "prime" | "snaps">;

/** A row's step only where it decides the row's placing: a spell-executed row, or a change still pending in the spell group. */
const rowStep = (reason: AuditReason, step: OnchainStep | null): OnchainStep | null =>
  (step?.kind === "executed" && reason === "spell-executed") || (step?.kind === "pending" && AUDIT_REASONS[reason].group === "spell") ? step : null;

function valueRows({ primeId, prime, checks }: PrimeChecks, input: AuditInput): AuditRow[] {
  const ctx = { ...input.votes, prime, snaps: input.snaps.filter((s) => s.prime === primeId) };
  return checks.flatMap((c) => {
    const entries = DATED.has(c.status) ? input.history.get(c.docId) : undefined;
    const dates = { chain: c.limit?.setAt?.time.slice(0, 10) ?? null, atlas: entries ? valueChangedAt(entries, c.stated) : null };
    const step = onchainStep(c, dates.atlas, ctx);
    const reason = checkReason(c, checks, dates, step, operatorAdjustable(c, deploymentsOf(c, ctx.snaps)));
    if (!reason) return [];
    return [{
      item: `value:${c.docId}:${c.field}`, group: AUDIT_REASONS[reason].group, reason, note: AUDIT_REASONS[reason].text, primeId, prime,
      chain: c.chain ?? "", kind: c.kind, subject: c.instance, label: c.label, stated: c.stated, onchain: onchainText(c),
      docId: c.docId, key: c.key, contract: c.contract, chainSetAt: dates.chain, atlasChangedAt: dates.atlas, step: rowStep(reason, step),
    }];
  });
}

function wiringRows(snaps: StoredPauSnapshot[]): AuditRow[] {
  return snaps.flatMap((s) => {
    const w = controllerWiring(s);
    if (!w || (w.proxy && w.rateLimits)) return [];
    const reason: AuditReason = w.proxy || w.rateLimits ? "partly-wired" : "not-wired";
    const controller = s.contracts.find((c) => c.role === "controller")!;
    const holds = [w.proxy && "ALM proxy", w.rateLimits && "rate limits"].filter(Boolean).join(", ");
    return [{
      item: `wiring:${s.deployment}`, group: "spell", reason, note: AUDIT_REASONS[reason].text, primeId: s.prime, prime: s.primeName,
      chain: s.chain, kind: s.kind, subject: "Controller", label: "CONTROLLER role", stated: "on its ALM proxy and rate limits", onchain: holds ? `on its ${holds} only` : "on neither",
      docId: controller.atlasDocs?.[0] ?? null, key: null, contract: controller.address, chainSetAt: null, atlasChangedAt: null, step: null,
    }];
  });
}

/** One row per rejected claim and document stating it, so each row cites one document. */
function claimRows(claims: PauIgnored[], primeNames: Map<string, string>): AuditRow[] {
  return claims.flatMap((g) =>
    (g.docs?.length ? g.docs : [null]).map((docId) => ({
      item: `claim:${g.prime ?? "shared"}:${g.chain}:${g.role}:${g.address}`, group: "registry" as const, reason: "rejected-claim" as const, note: g.reason,
      primeId: g.prime, prime: g.prime ? (primeNames.get(g.prime) ?? "") : "Shared", chain: g.chain, kind: g.kind ?? null, subject: "Atlas role claim",
      label: g.role, stated: g.address, onchain: "", docId, key: null, contract: g.address, chainSetAt: null, atlasChangedAt: null, step: null,
    })),
  );
}

const GROUP_ORDER = new Map(AUDIT_GROUPS.map((g, i) => [g.key, i]));
const cmp = (a: AuditRow, b: AuditRow) =>
  GROUP_ORDER.get(a.group)! - GROUP_ORDER.get(b.group)! ||
  [a.prime, a.chain, a.kind ?? "", a.subject, a.label, a.key ?? "", a.docId ?? ""].join("\u0000").localeCompare([b.prime, b.chain, b.kind ?? "", b.subject, b.label, b.key ?? "", b.docId ?? ""].join("\u0000"), "en", { numeric: true });

export interface AuditInput {
  primes: PrimeChecks[];
  snaps: StoredPauSnapshot[];
  claims: PauIgnored[];
  /** Atlas document id → its history, for the documents `docsToDate` names. */
  history: ReadonlyMap<string, readonly HistoryEntry[]>;
  votes: AuditVotes;
}

/** Every audit row, sorted by group, then prime, chain, subject and value. */
export function buildPauAudit(input: AuditInput): AuditRow[] {
  const { primes, snaps, claims } = input;
  const primeNames = new Map(primes.map((p) => [p.primeId, p.prime]));
  return [...primes.flatMap((p) => valueRows(p, input)), ...wiringRows(snaps), ...claimRows(claims, primeNames)].sort(cmp);
}

/** How many items (values, controllers, claims) the rows hold. */
export const auditItemCount = (rows: AuditRow[]): number => new Set(rows.map((r) => r.item)).size;
