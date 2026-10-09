import { describe, expect, test } from "bun:test";
import { prEnvGate } from "./gate.ts";

describe("prEnvGate", () => {
  test("a Railway PR environment is inert", () => {
    expect(prEnvGate("pr-123", undefined).inert).toBe(true);
    expect(prEnvGate("pr-1", "").inert).toBe(true);
  });

  test("production, development, no Railway and near-miss names stay live", () => {
    for (const env of ["production", "development", "", "redlens-pr-12", "pr-12a", "expr-12", "pr-"]) {
      expect(prEnvGate(env, undefined).inert).toBe(false);
    }
  });

  test("PR_ENV_INERT=1 forces it on and 0 forces it off, whatever the name", () => {
    expect(prEnvGate("production", "1").inert).toBe(true);
    expect(prEnvGate("", "1").inert).toBe(true);
    expect(prEnvGate("pr-123", "0").inert).toBe(false);
  });

  test("any other override value defers to the name", () => {
    expect(prEnvGate("pr-5", "yes").inert).toBe(true);
    expect(prEnvGate("production", "true").inert).toBe(false);
  });

  test("the startup line says which way it resolved and why", () => {
    expect(prEnvGate("pr-123", undefined).line).toStartWith('PR-environment mode ON (env="pr-123")');
    expect(prEnvGate("production", undefined).line).toStartWith('PR-environment mode OFF (env="production")');
    expect(prEnvGate("pr-123", "0").line).toStartWith('PR-environment mode OFF (PR_ENV_INERT=0, env="pr-123")');
  });
});
