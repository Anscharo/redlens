// The Railway configuration in .railway/railway.ts, evaluated the way the CLI
// evaluates it, held to the repository it deploys.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRailwayContext, project } from "railway/iac";

import program, { WEB_SERVICE, WORKER_SERVICE, partial } from "../.railway/railway.ts";
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
  return { definition, web: byName.get(WEB_SERVICE)!, worker: byName.get(WORKER_SERVICE)! };
}

describe(".railway/railway.ts", () => {
  it("is a named partial that leaves variables to the dashboard", async () => {
    const { definition } = await evaluate("production");
    // Without a partial, an apply deletes every resource the file omits, Postgres included.
    expect(partial).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(definition.variables).toEqual({ managed: false });
  });

  it("declares exactly the two services built from this repository, each with its repo and no branch", async () => {
    const { definition } = await evaluate("production");
    expect(definition.resources.map((r) => `${r.type}.${r.name}`).sort()).toEqual(
      [`service.${WEB_SERVICE}`, `service.${WORKER_SERVICE}`].sort(),
    );
    // An omitted source plans as a disconnect; a branch would override every environment's own.
    for (const r of definition.resources) expect(r.source).toEqual({ type: "github", repo: "Anscharo/redlens" });
  });

  it("renders the same services in every environment", async () => {
    const prod = await evaluate("production");
    for (const env of ["redlens-development", "redlens-pr-292"]) {
      expect((await evaluate(env)).definition).toEqual(prod.definition);
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
});

// Railway reads railway.toml / railway.worker.toml until each service is cut
// over to IaC (docs/DEPLOYMENT.md, "Railway configuration"). Until the files
// are deleted they must say what .railway/railway.ts says, so a deploy before
// and after the cutover builds and runs the same way.
function tomlSettings(file: string): Record<string, unknown> {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\s*#.*$/gm, "");
  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(/^(\w+)\s*=\s*("[^"]*"|\d+)\s*$/gm)) out[m[1]] = JSON.parse(m[2]);
  const patterns = /watchPatterns\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (patterns) out.watchPatterns = [...patterns[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return out;
}

describe.each([
  ["railway.toml", WEB_SERVICE, "Dockerfile"],
  ["railway.worker.toml", WORKER_SERVICE, "Dockerfile.worker"],
])("%s while it still exists", (file, name, defaultDockerfile) => {
  it.skipIf(!fs.existsSync(path.join(ROOT, file)))(`agrees with service ${name}`, async () => {
    const { web, worker } = await evaluate("production");
    const svc = name === WEB_SERVICE ? web : worker;
    const toml = tomlSettings(file);
    expect({ dockerfilePath: defaultDockerfile, ...toml }).toEqual({ ...svc.build, ...svc.deploy });
    expect(svc.source).toBeDefined();
  });
});
