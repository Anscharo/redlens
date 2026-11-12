// Who can change a Solana limit: a spell alone, relayed over LayerZero
// governance to the holder of an active Default Admin Role Permission, read
// from the deployment's Permission contracts; a suspended admin is not one; no
// Operator route; the route cites the setter for a Reserve or an Integration,
// the admin role and the SubProxy's whitelisting, by doc_no where at hand.
import { describe, expect, it } from "vitest";
import { svmCheck, svmSnap, SVM_ADMIN } from "./pauPending.fixture.ts";
import { keyRoutes } from "./pauKeyRoutes.ts";
import { routesText } from "./pauRouteText.ts";
import { SVM_ROUTE_DOCS } from "./pauSvmRoutes.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const PAU = { entries: [], queued: [] };
const docs = SVM_ROUTE_DOCS["bc6aed17-2969-4d04-9af6-c7bf3e4497e6"];
const DOC_NOS: Record<string, string> = { [docs.admin]: "A.admin", [docs.reserve]: "A.reserve", [docs.integration]: "A.integration", [docs.whitelist]: "A.whitelist" };
const docNo = (uuid: string) => DOC_NOS[uuid] ?? null;

describe("svm key routes", () => {
  it("routes a Solana limit through the active admin Permission's holder, by spell over LayerZero, with no Operator", () => {
    const r = keyRoutes(svmCheck("mismatch"), [svmSnap()], PAU, NOW, docNo);
    expect(r).toEqual({ admins: [SVM_ADMIN], operator: null, relay: { via: "layerzero", cites: ["A.integration", "A.admin", "A.whitelist"] } });
    expect(routesText(r!)).toBe("Set by spell, relayed to Solana through LayerZero governance and signed by FDFsob…k7Zk (Atlas A.integration, A.admin, A.whitelist); the Operator has no route to a Solana limit");
  });
  it("cites the Reserve setter for a Reserve, and leaves cites out without the documents", () => {
    expect(keyRoutes(svmCheck("not-set", { key: "reserve:usdswr9apdhk5bvjkmjzff41ffux8bsxdkcr81vtwca", limit: undefined }), [svmSnap()], PAU, NOW, docNo)?.relay?.cites?.[0]).toBe("A.reserve");
    expect(keyRoutes(svmCheck("mismatch"), [svmSnap()], PAU, NOW)?.relay).toEqual({ via: "layerzero" });
  });
  it("names any other active admin as able to set the limit directly, outside the cited spell route", () => {
    const snap = svmSnap();
    const both = { ...snap, contracts: snap.contracts.map((c) => (c.roles?.[0].account.startsWith("PcJcgd") ? { ...c, roles: [{ ...c.roles[0], holds: true }] } : c)) };
    const r = keyRoutes(svmCheck("mismatch"), [both], PAU, NOW, docNo)!;
    expect(r).toMatchObject({ admins: [SVM_ADMIN], relay: { direct: ["PcJcgdWmFZznhhfN28i6T8GHcwA6jmFGuUeNNGvcSY2"] } });
    expect(routesText(r)).toContain("signed by FDFsob…k7Zk (Atlas A.integration, A.admin, A.whitelist); PcJcgd…cSY2 can also set it directly as an admin, with no spell; the Operator");
    const only = keyRoutes(svmCheck("mismatch"), [{ ...both, contracts: both.contracts.filter((c) => c.roles?.[0].account !== SVM_ADMIN) }], PAU, NOW, docNo)!;
    expect(only).toEqual({ admins: [], operator: null, relay: { via: "layerzero", direct: ["PcJcgdWmFZznhhfN28i6T8GHcwA6jmFGuUeNNGvcSY2"] } });
    expect(routesText(only)).toMatch(/^Set directly by its admin PcJcgd…cSY2, with no spell/);
  });
  it("names no route when no admin Permission is active", () => {
    expect(keyRoutes(svmCheck("mismatch"), [svmSnap(false)], PAU, NOW)).toBeNull();
  });
});
