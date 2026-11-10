// The on-chain checks behind an instance card's rows. A row is one param the
// instance states; a check is one maxAmount or slope against one deployment
// (pauAtlasValues.ts). A row finds its checks by the instance, the document
// that states it and the value's label, the same three things the check
// records, so a row never borrows another instance's or another side's verdict.
import { valueParam, type ValueCheck } from "@/lib/pauAtlasValues";
import type { InstanceParam } from "@/lib/radarRules";
import type { LiveRateLimit } from "@/lib/pau";
import { isOff } from "@/lib/pauLimitOrder";
import { isUnstated } from "@/lib/plainCheck";
import { heldKeyId, sentence, type RowMark, type TipLine } from "./rowMark";
import { allPending, isPending } from "@/lib/pauPending";
import { routesText } from "@/lib/pauRouteText";
import { pendingStepText, pendingText, stepText } from "@/lib/pauStepText";
import { contractValue, fieldValue, isCompared, VALUE_STATUS } from "./valueStatus";

export type ParamChecks = ReadonlyMap<string, ValueCheck[]>;

const rowId = (instanceDocId: string | null, docId: string, label: string) => `${instanceDocId ?? ""}|${docId}|${label}`;

/** A prime's checks, keyed for the card rows that state them. */
export function indexParamChecks(checks: ValueCheck[]): ParamChecks {
  const out = new Map<string, ValueCheck[]>();
  for (const c of checks) {
    const id = rowId(c.instanceDocId, c.docId, c.label);
    out.set(id, [...(out.get(id) ?? []), c]);
  }
  return out;
}

/** A row's checks; empty for a param that is not a maxAmount or slope, or that no check covers. */
export function checksForParam(index: ParamChecks, instanceDocId: string | null, p: InstanceParam): ValueCheck[] {
  const v = valueParam(p.key);
  if (!v || !p.srcDocId) return [];
  return (index.get(rowId(instanceDocId, p.srcDocId, v.label)) ?? []).filter((c) => c.stated === p.value);
}

/**
 * The one mark a row shows for all its checks. "candidate": the chain holds
 * what the atlas leaves to be specified, so the atlas is probably behind: a
 * value whose key is switched on (unstatedValueMark), or a RateLimitID where a
 * key derived from the instance's addresses is (addressMarks.ts).
 */
export type ParamMark = "match" | "mismatch" | "pending" | "not-set" | "not-stated" | "candidate" | "unsure";

/**
 * Any certain difference is a mismatch, unless every one is an atlas change
 * the chain is still expected to catch up on ("pending", src/lib/pauPending.ts);
 * a match needs every deployment to
 * agree; a key read and never set is "not-set"; a value the atlas leaves unset
 * is "not-stated"; anything else cannot be told and says so.
 */
export function paramMark(checks: ValueCheck[]): ParamMark | null {
  if (checks.length === 0) return null;
  if (allPending(checks)) return "pending";
  if (checks.some((c) => c.status === "mismatch")) return "mismatch";
  if (checks.every((c) => c.status === "match" || c.status === "no-limit")) return "match";
  if (checks.some((c) => c.status === "not-set")) return "not-set";
  if (checks.every((c) => c.status === "not-stated")) return "not-stated";
  return "unsure";
}

const VALUE_HEAD: Record<ParamMark, string> = {
  match: "Matches the atlas",
  mismatch: "Differs from the atlas",
  pending: "On-chain update pending",
  "not-set": "Not set on the contract",
  "not-stated": "The atlas sets no value yet",
  candidate: "The atlas sets no value yet",
  unsure: "Can't be compared",
};

/** A deployment as a card tooltip names it, in plain words: not every controller is a PAU. */
const KIND_LABEL: Record<NonNullable<ValueCheck["kind"]>, string> = { monolithic: "monolithic controller", diamond: "diamond controller", svm: "Solana ALM controller" };

/** Each deployment's lines: the value it holds and when it was set, or why there is none, said once per deployment. */
function checkLines(checks: ValueCheck[]): TipLine[] {
  const many = checks.length > 1;
  const said = new Set<string>();
  return checks.flatMap((c): TipLine[] => {
    const where = many && c.kind ? ` · ${KIND_LABEL[c.kind]}` : "";
    if (isCompared(c)) return [{ label: `On-chain${where}`, value: contractValue(c) }, { set: c.limit!.setAt, chain: c.chain!, readAt: c.readAt }];
    const text = `${sentence(VALUE_STATUS[c.status].text)}${where}`;
    if (said.has(text)) return [];
    said.add(text);
    return [{ text }];
  });
}

/** The check whose step explains the mark: on a ✗, a mismatch that is not pending; else a mismatch's step, then any. */
const deciding = (checks: ValueCheck[], mark: ParamMark) => {
  const off = checks.filter((c) => c.status === "mismatch" && c.onchain);
  const fits = mark === "pending" ? off.find((c) => isPending(c.onchain)) : off.find((c) => !isPending(c.onchain));
  return (fits ?? off[0] ?? checks.find((c) => c.onchain))?.onchain;
};

/** What governance did about the row's atlas change (src/lib/pauStepText.ts): for a pending one, when the atlas changed, what it waits on and until when. */
function onchainLines(checks: ValueCheck[], mark: ParamMark): TipLine[] {
  const step = deciding(checks, mark);
  if (!step) return [];
  if (step.kind !== "pending") return [{ text: sentence(step.kind === "recording" ? pendingText(step) : stepText(step)) }];
  const p = step.pending;
  return [{ label: "Atlas changed", value: `${p.atlasChanged}${p.pr ? ` · PR #${p.pr}` : ""}` }, { label: "Spell", value: p.date }, { text: sentence(pendingStepText(p.step)) }, { label: "Expected by", value: p.expectedBy }];
}

/** A maxAmount or slope row's mark: the verdict over its checks, each deployment's value, and the atlas's on a mismatch. */
export function valueRowMark(checks: ValueCheck[]): RowMark {
  const mark = paramMark(checks)!;
  const atlas: TipLine[] = mark === "mismatch" || mark === "pending" ? [{ label: "Atlas", value: checks[0].stated }] : [];
  const head = mark === "pending" && checks.every((c) => c.status !== "mismatch" || c.onchain?.kind === "recording") ? "Atlas update pending" : VALUE_HEAD[mark];
  const routes = checks.find((c) => c.routes)?.routes;
  const who: TipLine[] = routes && mark !== "match" ? [{ text: routesText(routes) }] : [];
  return { mark, head, lines: [...checkLines(checks), ...atlas, ...onchainLines(checks, mark), ...who], docId: checks[0].docId };
}

/**
 * A value the atlas leaves to be specified while the PAU holds its key switched
 * on: the atlas is probably behind, so the row gets the "candidate" mark with
 * what the chain holds. Null for any other value (an "N/A" says it does not
 * apply), and when no key of its checks is held on.
 */
export function unstatedValueMark(checks: ValueCheck[], held: ReadonlyMap<string, LiveRateLimit[]>): RowMark | null {
  if (paramMark(checks) !== "not-stated" || !isUnstated(checks[0].stated)) return null;
  const limits = checks.flatMap((c) => (c.key && c.chain ? (held.get(heldKeyId(c.chain, c.key)) ?? []) : [])).filter((r) => !isOff(r));
  if (limits.length === 0) return null;
  const field = checks[0].field;
  const lines = limits.flatMap((r): TipLine[] => [{ label: "On-chain", value: fieldValue(r, field) }, { set: r.setAt, chain: checks[0].chain!, readAt: null }]);
  return { mark: "candidate", head: "The atlas states no value, but the chain holds one", lines: [...lines, { label: "Atlas", value: checks[0].stated }], docId: checks[0].docId };
}
