// Guard against a whole class of cross-file test failure that a normal
// `bun test` run cannot surface.
//
// bun's `mock.module(spec, factory)` replaces the module registry entry for the
// REST OF THE PROCESS, and `mock.restore()` does not undo it. So if a factory
// omits an export the real module has, every test file bun loads afterwards
// that imports that name dies at LINK time:
//
//   SyntaxError: Export named 'toVectorLiteral' not found in module .../db.ts
//
// That aborts the importing file before it registers any tests — so the run
// prints no "(fail)" line, the file's tests simply vanish from the count, and
// the only visible symptom is a nonzero exit code. Worse, bun walks test files
// in readdir order (NOT alphabetically), which is filesystem-dependent, so
// which file gets hit changes between machines and between checkouts. That is
// what makes this present as flakiness rather than as a plain bug.
//
// A factory that spreads the real namespace (`{ ...baseExports, sql: … }`) is
// always safe and is skipped here.
//
// Run: node scripts/aux/audit-mock-modules.mjs   (exits 1 if anything is found)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const files = execSync('find src/server scripts -name "*.test.ts"').toString().trim().split("\n").filter(Boolean);

// Matches only up to the factory's opening `({`. The body is then taken by
// balancing braces rather than by a lazy `}\)` — a factory containing a nested
// object (`sql: () => ({ … })`) would otherwise be cut at the inner `})`, and a
// truncated body reads as "export absent", which is the one direction this
// script must never get wrong: it would report a problem that isn't there, or
// miss the tail of a body where the export actually appears.
const MOCK_HEAD_RE = /mock\.module\(\s*["']([^"']+)["']\s*,\s*(?:async\s*)?\(\)\s*=>\s*\(\{/g;

// Brace-balanced slice starting at the `{` index, skipping over strings,
// template literals and comments so their braces don't shift the depth.
function objectBodyAt(src, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === quote) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i);
      if (i === -1) break;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(openBrace + 1, i);
  }
  return null; // unbalanced — treat as unparseable rather than guessing
}

function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const n of m[1].split(",")) names.add(n.trim().split(/\s+as\s+/).pop().trim());
  }
  return names;
}

const problems = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(MOCK_HEAD_RE)) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue; // bare specifiers: not ours to police
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) continue;
    const body = objectBodyAt(src, m.index + m[0].length - 1);
    if (body === null) continue;
    if (body.includes("...")) continue; // spreads the real namespace — complete by construction
    const missing = [...exportsOf(fs.readFileSync(target, "utf8"))].filter(
      (n) => !new RegExp(`(^|[^\\w.])${n}\\s*[:,}]`).test(body),
    );
    if (missing.length) problems.push(`${file}\n    mocks ${spec}, dropping: ${missing.join(", ")}`);
  }
}

if (problems.length) {
  console.error(`Incomplete mock.module factories (${problems.length}):\n`);
  console.error(problems.join("\n"));
  console.error("\nSpread the real namespace instead: mock.module(spec, () => ({ ...baseExports, sql: yourStub }))");
  process.exit(1);
}
console.log(`✓ all mock.module factories are export-complete (${files.length} test files scanned)`);
