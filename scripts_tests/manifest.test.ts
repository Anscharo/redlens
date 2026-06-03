// public/manifest.json records build provenance (atlasCommit, redlensCommit).
// Hash verification was removed — artifact content changes without a new deploy
// (atlas worker updates data in Postgres; web service reserialises from DB).

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const MANIFEST_PATH = path.join(PUBLIC, "manifest.json");

describe.skipIf(!fs.existsSync(MANIFEST_PATH))("manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    redlensCommit: string | null;
    atlasCommit: string | null;
  };

  it("pins the redlens + atlas commits for this build", () => {
    expect(manifest.redlensCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.atlasCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});
