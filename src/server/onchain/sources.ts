// The on-chain sources the tools read. A new source is one more entry: it reads
// its own stored state and returns OnchainFacts (facts.ts).
import type { OnchainSource } from "./facts.ts";
import { pauSource } from "./pau-source.ts";

export const ONCHAIN_SOURCES: OnchainSource[] = [pauSource];
