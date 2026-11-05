// Which source reads a chain's PAU history: HyperSync for a flagged chain once
// ENVIO_API_TOKEN is set, else the chain's logsRpcs, else none (the explorer
// path reads it).
import { describe, expect, it } from "vitest";
import { logSourcesFor } from "../scripts/lib/log-sources.ts";

const urls = (chain: string, env: NodeJS.ProcessEnv) => logSourcesFor(chain, env).map((s) => s.url);

describe("logSourcesFor", () => {
  it("reads a flagged chain from HyperSync when the token is set", () => {
    expect(urls("base", { ENVIO_API_TOKEN: "tok" })).toEqual(["https://8453.hypersync.xyz"]);
    expect(urls("ethereum", { ENVIO_API_TOKEN: "tok" })).toEqual(["https://1.hypersync.xyz"]);
  });
  it("falls back to logsRpcs, then to nothing, without a token", () => {
    expect(urls("base", {})).toEqual(["https://mainnet.base.org"]);
    expect(urls("base", { ENVIO_API_TOKEN: "  " })).toEqual(["https://mainnet.base.org"]);
    expect(urls("ethereum", {})).toEqual([]);
  });
  it("leaves a chain HyperSync does not serve to the explorers", () => {
    expect(urls("xlayer", { ENVIO_API_TOKEN: "tok" })).toEqual([]);
  });
});
