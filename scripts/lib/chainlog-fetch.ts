import { readChainlogOnchain } from "./chainlog-onchain.ts";

const CHAINLOG_URL = "https://chainlog.skyeco.com/api/mainnet/active.json";

async function fetchChainlogJson(): Promise<Record<string, unknown>> {
  const res = await fetch(CHAINLOG_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // A 200 with null, an array or {} is an outage in disguise: fall through to the contract.
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
    throw new Error("unexpected response shape");
  }
  return data as Record<string, unknown>;
}

/**
 * addr → chainlog name. Reads the website first and the ChainLog contract when
 * the website fails, so an outage at chainlog.skyeco.com does not stop the
 * build. `readOnchain` is injectable so tests never reach a live RPC.
 */
export async function fetchChainlog(
  readOnchain: () => Promise<Record<string, unknown>> = readChainlogOnchain,
): Promise<Record<string, string> | null> {
  let data: Record<string, unknown>;
  try {
    data = await fetchChainlogJson();
  } catch (err) {
    console.warn(`! chainlog fetch failed (${(err as Error).message}) — reading the ChainLog contract instead`);
    try {
      data = await readOnchain();
    } catch (err2) {
      console.warn(`! on-chain chainlog read failed (${(err2 as Error).message}) — proceeding without chainlog labels`);
      // null = both sources failed (distinct from a real, never-empty result)
      // so callers can refuse to overwrite artifacts with empty data.
      return null;
    }
  }
  // chainlog shape: { "MCD_VAT": "0x35D1…", ... }
  const inverted: Record<string, string> = {};
  for (const [name, addr] of Object.entries(data)) {
    if (typeof addr === "string" && addr.startsWith("0x")) {
      inverted[addr.toLowerCase()] = name;
    }
  }
  return inverted;
}
