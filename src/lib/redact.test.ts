import { describe, it, expect } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ4dQw4w9WgXcQ4dQw4w9WgXcQ";
    expect(redact(`Authorization: ${jwt}`)).toBe("Authorization: [jwt]");
  });

  it("redacts a code= query param", () => {
    expect(redact("https://x.com/cb?code=abcDEF123&foo=bar")).toBe(
      "https://x.com/cb?code=[redacted]&foo=bar",
    );
  });

  it("redacts a state= query param", () => {
    expect(redact("https://x.com/cb?state=xyz789")).toBe("https://x.com/cb?state=[redacted]");
  });

  it("redacts token/key/secret/password/access_token/id_token/api_key params", () => {
    const names = ["token", "key", "secret", "password", "access_token", "id_token", "api_key"];
    for (const name of names) {
      expect(redact(`?${name}=abc123`)).toBe(`?${name}=[redacted]`);
    }
  });

  it("redacts an sk- style API key", () => {
    expect(redact("key is sk-abcdefghijklmnopqrstuvwxyz")).toBe("key is [key]");
  });

  it("redacts a phc_ posthog key", () => {
    expect(redact("phc_abcdefghijklmnopqrstuvwx")).toBe("[key]");
  });

  it("redacts ghp_/gho_/ghu_/ghs_/ghr_ github tokens", () => {
    for (const p of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      expect(redact(`${p}_abcdefghijklmnopqrstuvwx`)).toBe("[key]");
    }
  });

  it("redacts a Bearer token", () => {
    expect(redact("Authorization: Bearer abc.def-ghi_123")).toBe("Authorization: Bearer [key]");
  });

  it("applies JWT redaction before generic key rules (order matters)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2Nzg5MA";
    expect(redact(jwt)).toBe("[jwt]");
  });

  // --- negative cases: must survive byte-identical ---

  it("does not redact an EVM address", () => {
    const addr = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    expect(redact(addr)).toBe(addr);
    expect(redact(`owner is ${addr} on mainnet`)).toBe(`owner is ${addr} on mainnet`);
  });

  it("does not redact a doc UUID", () => {
    const uuid = "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071";
    expect(redact(uuid)).toBe(uuid);
    expect(redact(`node id ${uuid} not found`)).toBe(`node id ${uuid} not found`);
  });

  it("does not redact ordinary prose containing the word 'token'", () => {
    const prose = "The MKR token is the governance token of the Sky ecosystem.";
    expect(redact(prose)).toBe(prose);
  });

  it("does not redact a long base58-looking Solana address", () => {
    const sol = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
    expect(redact(sol)).toBe(sol);
    expect(redact(`solana addr: ${sol}`)).toBe(`solana addr: ${sol}`);
  });
});
