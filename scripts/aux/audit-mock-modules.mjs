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
// The second class this catches is the inverse: a factory that supplies a name
// the target only RE-EXPORTS from somewhere else (`export { fromUuidArray } from
// "./pg-array.ts"`). Those helpers are split out of db.ts precisely so a
// process-wide db.ts mock cannot reach them — hand-rolling one in a factory
// defeats the split and silently diverges. `fromUuidArray` is the live example:
// a stub written as `Array.isArray(v) ? v.map(String) : []` returns [] for
// `{uuid,uuid}`, the exact Postgres text form Bun.sql actually hands back, so
// the read path reads as "covered" while never running. Import the real one
// from the re-export source and pass it through as shorthand.
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

// Blank out comments so a name merely MENTIONED in a rationale comment inside the
// factory can't read as a definition. Same-length replacement keeps offsets valid.
function stripComments(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const start = i;
      for (i++; i < body.length; i++) {
        if (body[i] === "\\") i++;
        else if (body[i] === quote) break;
      }
      out += body.slice(start, i + 1);
      continue;
    }
    if (c === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
      const end =
        body[i + 1] === "/"
          ? (body.indexOf("\n", i) === -1 ? body.length : body.indexOf("\n", i))
          : (body.indexOf("*/", i) === -1 ? body.length : body.indexOf("*/", i) + 2);
      out += body.slice(i, end).replace(/[^\n]/g, " ");
      i = end - 1;
      continue;
    }
    out += c;
  }
  return out;
}

// name -> absolute path of the module the target re-exports it FROM.
// `export { a, b } from "./x.ts"` only; a plain local `export const` is not a
// re-export and is fair game for a stub.
function reexportsOf(source, targetPath) {
  const out = new Map();
  for (const m of source.matchAll(/^export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm)) {
    const from = path.resolve(path.dirname(targetPath), m[2]);
    for (const n of m[1].split(",")) out.set(n.trim().split(/\s+as\s+/).pop().trim(), from);
  }
  return out;
}

// Every name the file imports, mapped to the absolute path it came from.
function importsOf(source, filePath) {
  const out = new Map();
  for (const m of source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm)) {
    if (!m[2].startsWith(".")) continue;
    const from = path.resolve(path.dirname(filePath), m[2]);
    for (const n of m[1].split(",")) {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (name && name !== "type") out.set(name, from);
    }
  }
  return out;
}

// True only for a spread ELEMENT of the factory object (`{ ...baseExports, … }`).
// A plain `body.includes("...")` also fires on a rest parameter in a nested method
// signature (`sql(_strings: TemplateStringsArray, ..._values: unknown[])`), which
// silently exempted whole factories from every check below — that is how the
// hand-rolled `fromUuidArray` stub in preview/handler.test.ts survived this audit.
// Depth-0 is measured over the body slice, which excludes the outer braces.
function hasNamespaceSpread(body) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      for (i++; i < body.length; i++) {
        if (body[i] === "\\") i++;
        else if (body[i] === quote) break;
      }
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      i = body.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      i = body.indexOf("*/", i);
      if (i === -1) break;
      i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0 && c === "." && body.startsWith("...", i)) return true;
  }
  return false;
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
    if (hasNamespaceSpread(body)) continue; // spreads the real namespace — complete by construction
    const code = stripComments(body);
    const targetSrc = fs.readFileSync(target, "utf8");
    // Present = defined as a PROPERTY of the factory object: `sql: fn`, shorthand
    // `sql,` / `sql}`, or method shorthand `sql(strings, …) {`. Anchoring to a line
    // start or a preceding `{`/`,` keeps a mere mention (`return sql(q)` in another
    // property's body) from reading as a definition.
    const missing = [...exportsOf(targetSrc)].filter(
      (n) => !new RegExp(`(?:^|[{,])\\s*(?:async\\s+)?${n}\\s*[:,}(]`, "m").test(code),
    );
    if (missing.length) problems.push(`${file}\n    mocks ${spec}, dropping: ${missing.join(", ")}`);

    // Re-exported names must be passed through, not re-implemented.
    const imported = importsOf(src, file);
    for (const [name, from] of reexportsOf(targetSrc, target)) {
      const rel = path.relative(path.dirname(file), from) || ".";
      const via = rel.startsWith(".") ? rel : `./${rel}`;
      if (new RegExp(`(^|[^\\w.])${name}\\s*:`).test(code)) {
        problems.push(
          `${file}\n    mocks ${spec}, re-implementing ${name} — ${spec} only re-exports it from ${via}.` +
            `\n    Import the real one (\`import { ${name} } from "${via}"\`) and pass it through as shorthand.`,
        );
      } else if (new RegExp(`(^|[^\\w.])${name}\\s*[,}]`).test(code) && imported.get(name) !== from) {
        problems.push(
          `${file}\n    mocks ${spec}, passing a local ${name} through — it must be the real one from ${via}.`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`Incomplete mock.module factories (${problems.length}):\n`);
  console.error(problems.join("\n"));
  console.error(
    "\nDropped exports: spread the real namespace instead —" +
      " mock.module(spec, () => ({ ...baseExports, sql: yourStub }))." +
      "\nRe-exported names: import the real one from the module it is re-exported from" +
      " and pass it through as shorthand.",
  );
  process.exit(1);
}
console.log(`✓ all mock.module factories are export-complete and pass re-exports through (${files.length} test files scanned)`);
