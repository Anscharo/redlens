// What every instance-card check outside the value checks says, and the few
// things they all say the same way: a value the atlas leaves to be specified,
// nothing indexed for a param, and an address in short. One place, so the rules
// a card applies cannot drift between the check modules.

/** One tooltip line: a labelled value, or a sentence. */
export type PlainLine = { label: string; value: string } | { text: string };

/** A row's verdict, said in full: "candidate" when the chain holds what the atlas leaves to be specified. */
export interface PlainCheck {
  status: "match" | "mismatch" | "not-set" | "not-stated" | "candidate" | "unsure";
  head: string;
  lines: PlainLine[];
}

/** The reason given where no contract on the param's chain is indexed: the contract may not be a PAU, and a new one is often just not in the registry yet. */
export const NOT_INDEXED = "param or contract not yet indexed";

/**
 * Whether the atlas leaves a value to be specified. Only this placeholder is:
 * an "N/A" says the value does not apply, which the chain holding one cannot
 * contradict.
 */
export const isUnstated = (text: string) => /specified in a future/i.test(text);

/** "0xdc03…384f". */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A check that cannot be made, with the reason as a sentence. */
export const unsure = (reason: string): PlainCheck => ({ status: "unsure", head: "Can't be checked", lines: [{ text: `${reason[0].toUpperCase()}${reason.slice(1)}.` }] });

export const notIndexed: PlainCheck = unsure(NOT_INDEXED);
