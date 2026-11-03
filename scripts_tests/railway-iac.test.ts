// The Railway configuration in .railway/railway.ts, evaluated the way the CLI
// evaluates it, held to the repository it deploys.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRailwayContext, project } from "railway/iac";

import program, { WEB_SERVICE, partial, workerServiceName } from "../.railway/railway.ts";
import { railwayWebWatchPatterns, railwayWorkerWatchPatterns } from "../scripts/lib/deploy-skip.ts";

const ROOT = path.resolve(__dirname, "..");

type Service = {
  name: string;
  type: string;
  source?: unknown;
  build?: Record<string, unknown>;
  deploy?: Record<string, unknown>;
};

async function evaluate(environment: string) {
  // The CLI passes the same two arguments: the context and a project factory.
  const definition = (await program(createRailwayContext({ environment }), project)) as unknown as {
    name: string;
    variables?: { managed?: boolean };
    resources: Service[];
  };
  const byName = new Map(definition.resources.map((r) => [r.name, r]));
  return { definition, web: byName.get(WEB_SERVICE)!, worker: byName.get(workerServiceName(environment))! };
}

describe(".railway/railway.ts", () => {
  it("is a named partial that leaves variables to the dashboard", async () => {
    const { definition } = await evaluate("production");
    // Without a partial, an apply deletes every resource the file omits, Postgres included.
    // Renaming it does not transfer ownership, so the name is pinned, not just well-formed.
    expect(partial).toBe("redlens");
    expect(definition.variables).toEqual({ managed: false });
  });

  it("declares exactly the two services built from this repository, each with its repo and no branch", async () => {
    const { definition } = await evaluate("production");
    expect(definition.resources.map((r) => `${r.type}.${r.name}`).sort()).toEqual(
      [`service.${WEB_SERVICE}`, `service.${workerServiceName("production")}`].sort(),
    );
    // An omitted source plans as a disconnect; a branch would override every environment's own.
    for (const r of definition.resources) expect(r.source).toEqual({ type: "github", repo: "Anscharo/redlens" });
  });

  it("names the worker per environment and otherwise renders the same services everywhere", async () => {
    const prod = await evaluate("production");
    expect(prod.worker.name).toBe("redlens-worker");
    for (const env of ["prod", "development", "redlens-pr-292"]) {
      const other = await evaluate(env);
      expect(other.worker.name).toBe("redlens worker");
      expect(other.web).toEqual(prod.web);
      expect({ ...other.worker, name: "", address: "" }).toEqual({ ...prod.worker, name: "", address: "" });
    }
  });

  it("names Dockerfiles and a worker entry point that exist", async () => {
    const { web, worker } = await evaluate("production");
    for (const svc of [web, worker]) {
      expect(svc.build?.builder).toBe("DOCKERFILE");
      expect(fs.existsSync(path.join(ROOT, String(svc.build?.dockerfilePath)))).toBe(true);
    }
    const workerEntry = String(worker.deploy?.startCommand).split(" ")[1];
    expect(fs.existsSync(path.join(ROOT, workerEntry))).toBe(true);
  });

  it("takes its watch patterns from scripts/lib/deploy-skip.ts", async () => {
    const { web, worker } = await evaluate("production");
    expect(web.build?.watchPatterns).toEqual(railwayWebWatchPatterns());
    expect(worker.build?.watchPatterns).toEqual(railwayWorkerWatchPatterns());
  });

  // Railway no longer reads Config as Code, so a railway.toml / railway.json
  // would be a second, silently ignored copy of these settings.
  it("is the only Railway config file in the repository", () => {
    for (const file of ["railway.toml", "railway.json", "railway.worker.toml", "railway.worker.json"]) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(false);
    }
  });
});
