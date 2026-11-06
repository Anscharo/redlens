// The on-chain checks behind an instance card's rows. A row is one param the
// instance states; a check is one maxAmount or slope against one deployment
// (pauAtlasValues.ts). A row finds its checks by the instance, the document
// that states it and the value's label, the same three things the check
// records, so a row never borrows another instance's or another side's verdict.
import { valueParam, type ValueCheck } from "@/lib/pauAtlasValues";
import type { InstanceParam } from "@/lib/radarRules";
import { PAU_KIND_LABEL } from "./pau";
import { sentence, type RowMark, type TipLine } from "./rowMark";
import { contractValue, isCompared, VALUE_STATUS } from "./valueStatus";

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
 * The one mark a row shows for all its checks. "candidate": the atlas has not
 * stated a RateLimitID, but the PAU holds keys derived from the instance's
 * addresses, one of which is probably the ID it should state (addressMarks.ts).
 */
export type ParamMark = "match" | "mismatch" | "not-set" | "not-stated" | "candidate" | "unsure";

/**
 * Any certain difference is a mismatch; a match needs every deployment to
 * agree; a key read and never set is "not-set"; a value the atlas leaves unset
 * is "not-stated"; anything else cannot be told and says so.
 */
export function paramMark(checks: ValueCheck[]): ParamMark | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.status === "mismatch")) return "mismatch";
  if (checks.every((c) => c.status === "match")) return "match";
  if (checks.some((c) => c.status === "not-set")) return "not-set";
  if (checks.every((c) => c.status === "not-stated")) return "not-stated";
  return "unsure";
}

const VALUE_HEAD: Record<ParamMark, string> = {
  match: "Matches the atlas",
  mismatch: "Differs from the atlas",
  "not-set": "Not set on the contract",
  "not-stated": "The atlas sets no value yet",
  candidate: "The atlas sets no value yet",
  unsure: "Can't be compared",
};

/** Each deployment's lines: the value it holds and when it was set, or why there is none, said once per deployment. */
function checkLines(checks: ValueCheck[]): TipLine[] {
  const many = checks.length > 1;
  const said = new Set<string>();
  return checks.flatMap((c): TipLine[] => {
    const where = many && c.kind ? ` · ${PAU_KIND_LABEL[c.kind]}` : "";
    if (isCompared(c)) return [{ label: `On-chain${where}`, value: contractValue(c) }, { set: c.limit!.setAt, chain: c.chain!, readAt: c.readAt }];
    const text = `${sentence(VALUE_STATUS[c.status].text)}${where}`;
    if (said.has(text)) return [];
    said.add(text);
    return [{ text }];
  });
}

/** A maxAmount or slope row's mark: the verdict over its checks, each deployment's value, and the atlas's on a mismatch. */
export function valueRowMark(checks: ValueCheck[]): RowMark {
  const mark = paramMark(checks)!;
  const atlas: TipLine[] = mark === "mismatch" ? [{ label: "Atlas", value: checks[0].stated }] : [];
  return { mark, head: VALUE_HEAD[mark], lines: [...checkLines(checks), ...atlas], docId: checks[0].docId };
}
