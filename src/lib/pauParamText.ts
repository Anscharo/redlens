// Plain words for a PAU parameter row: what the setting is, what it is for, and
// where it lives. A parameter is the latest value of one admin event on a PAU
// contract (`MintRecipientSet`, `MaxSlippageSet`, ...), keyed by the event's
// first argument (a pool, token, destination domain or endpoint). Pure.

const TITLES: Record<string, string> = {
  MintRecipientSet: "CCTP mint recipient",
  CCTPDomainParametersSet: "CCTP domain parameters",
  LayerZeroRecipientSet: "LayerZero recipient",
  CentrifugeRecipientSet: "Centrifuge recipient",
  MerklDistributorSet: "Merkl distributor",
  MaxSlippageSet: "Max slippage",
  MaxExchangeRateSet: "Max exchange rate",
};

/** Circle CCTP destination domains and LayerZero v2 endpoint ids this names; any other shows its number alone. */
const CCTP_DOMAINS: Record<string, string> = { "0": "Ethereum", "1": "Avalanche", "2": "OP Mainnet", "3": "Arbitrum", "5": "Solana", "6": "Base", "7": "Polygon", "10": "Unichain" };
const LAYERZERO_ENDPOINTS: Record<string, string> = { "30101": "Ethereum", "30106": "Avalanche", "30109": "Polygon", "30110": "Arbitrum", "30111": "OP Mainnet", "30168": "Solana", "30184": "Base" };

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
const PROPER: [RegExp, string][] = [[/\buniswap v(\d)/, "Uniswap V$1"], [/\baave\b/, "Aave"], [/\bcurve\b/, "Curve"], [/\botc\b/, "OTC"], [/\berc ?4626\b/, "ERC-4626"], [/\bmerkl\b/, "Merkl"], [/\bethena\b/, "Ethena"], [/\busds\b/, "USDS"]];

/** The setting's name: "CCTP mint recipient" for `MintRecipientSet`; an unlisted event is its name in words. */
export function paramTitle(event: string): string {
  const known = TITLES[event];
  if (known) return known;
  const w = PROPER.reduce((t, [re, to]) => t.replace(re, to), words(event.replace(/(Set|Updated)$/, "")));
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** What the row is for: "CCTP destination domain 5 (Solana)", "LayerZero endpoint 30168 (Solana)", else null (the subject is a pool, token or vault shown as itself). */
export function paramTarget(event: string, subject: string): string | null {
  if (event === "MintRecipientSet" || event === "CCTPDomainParametersSet") return `CCTP destination domain ${subject}${CCTP_DOMAINS[subject] ? ` (${CCTP_DOMAINS[subject]})` : ""}`;
  if (event === "LayerZeroRecipientSet") return `LayerZero endpoint ${subject}${LAYERZERO_ENDPOINTS[subject] ? ` (${LAYERZERO_ENDPOINTS[subject]})` : ""}`;
  if (event === "CentrifugeRecipientSet") return `Centrifuge id ${subject}`;
  return null;
}
