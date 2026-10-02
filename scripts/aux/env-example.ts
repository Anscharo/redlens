#!/usr/bin/env bun
// Writes .env.example from the env registry (src/server/env/). `--check` exits 1
// when the committed file differs instead of writing it.
import fs from "node:fs";
import path from "node:path";

import { ENV_GROUPS } from "../../src/server/env/registry.ts";
import { renderEnvExample } from "../../src/server/env/render.ts";

const file = path.resolve(import.meta.dir, "../../.env.example");
const next = renderEnvExample(ENV_GROUPS);

if (process.argv.includes("--check")) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current !== next) {
    console.error(".env.example is out of date. Run `pnpm env:example`.");
    process.exit(1);
  }
} else {
  fs.writeFileSync(file, next);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
