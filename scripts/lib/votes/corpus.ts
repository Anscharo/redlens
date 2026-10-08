// Reads a checkout of sky-ecosystem/executive-votes or sky-ecosystem/polls.
// Vote documents live one level down in year directories ("2025/", "2026/");
// everything else at the root (templates, processes, scripts, skills) is not
// a vote and is never read.

import fs from "node:fs";
import path from "node:path";

import { byDateThenFile } from "./assemble.ts";

const YEAR_DIR_RE = /^\d{4}$/;

/** Parses every `<year>/*.md` under `root` with `parse(relativePath, markdown)`. */
export function readVoteTree<T extends { date: string; file: string }>(
  root: string,
  parse: (file: string, md: string) => T,
): T[] {
  if (!fs.existsSync(root)) throw new Error(`votes: ${root} does not exist`);
  const out: T[] = [];
  for (const year of fs.readdirSync(root).filter((d) => YEAR_DIR_RE.test(d)).sort()) {
    const dir = path.join(root, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      out.push(parse(`${year}/${name}`, fs.readFileSync(path.join(dir, name), "utf8")));
    }
  }
  return out.sort(byDateThenFile);
}
