// Measures code lines per file and per function. Pure: source text in, numbers out.
//
// A "code line" has at least one non-whitespace character outside a comment.
// Blank and comment-only lines are free, so the size limits never push against
// the why-comments this repo relies on.
import { parseSync } from "oxc-parser";

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Per-line flags: true when the line holds code. Comment spans are blanked first. */
export function codeLineFlags(src, comments) {
  // Offsets are UTF-16 code units, so index the string the same way.
  const blanked = src.split("");
  for (const c of comments) {
    for (let i = c.start; i < c.end; i++) if (blanked[i] !== "\n") blanked[i] = " ";
  }
  return blanked.join("").split("\n").map((line) => line.trim() !== "");
}

/** Offset → 0-based line index, via a sorted table of line-start offsets. */
function lineIndexer(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
}

const WRAPPERS = new Set(["memo", "forwardRef", "useCallback"]);
const calleeName = (callee) => (callee.type === "MemberExpression" ? keyName(callee.property) : keyName(callee));

function keyName(node) {
  if (!node) return null;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") return node.name;
  if (node.type === "Literal") return String(node.value);
  return null;
}

/** The name a function is known by, or null for an anonymous callback. */
function functionName(node, parent, grandparent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === "VariableDeclarator") return keyName(parent.id);
  if (["Property", "MethodDefinition", "PropertyDefinition"].includes(parent?.type)) return keyName(parent.key);
  // const X = memo(() => …) / forwardRef(…) / useCallback(…): the function is the binding.
  const isWrapper = parent?.type === "CallExpression" && WRAPPERS.has(calleeName(parent.callee));
  if (isWrapper && grandparent?.type === "VariableDeclarator") return keyName(grandparent.id);
  return null;
}

/** Callee text for an anonymous top-level callback, e.g. `describe("x")` or `app.get`. */
function calleeLabel(call) {
  if (call?.type !== "CallExpression") return "<anonymous>";
  const c = call.callee;
  const callee = c.type === "MemberExpression" ? `${keyName(c.object) ?? "?"}.${keyName(c.property) ?? "?"}` : keyName(c) ?? "?";
  const arg = call.arguments[0];
  return arg?.type === "Literal" && typeof arg.value === "string" ? `${callee}(${JSON.stringify(arg.value)})` : callee;
}

function children(node) {
  const out = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const v of value) { if (v && typeof v.type === "string") out.push(v); }
    else if (value && typeof value.type === "string") out.push(value);
  }
  return out;
}

/** Collects every named function, plus anonymous callbacks not nested in a named one. */
function collectFunctions(program) {
  const found = [];
  const walk = (node, parent, grandparent, scope) => {
    let next = scope;
    if (node.type.startsWith("Class") && node.id?.name) next = [...scope, node.id.name];
    if (FUNCTION_TYPES.has(node.type)) {
      const name = functionName(node, parent, grandparent) ?? (scope.length ? null : calleeLabel(parent));
      if (name) {
        next = [...scope, name];
        found.push({ name: next.join("."), node });
      }
    }
    for (const child of children(node)) walk(child, node, parent, next);
  };
  walk(program, null, null, []);
  return found;
}

/** Disambiguates repeated names within one file with a `#n` suffix (stable for baselines). */
function uniqueNames(fns) {
  const seen = new Map();
  return fns.map((f) => {
    const n = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, n);
    return n === 1 ? f : { ...f, name: `${f.name}#${n}` };
  });
}

const isComponentName = (name) => /^[A-Z]/.test(name.split(".").pop().replace(/#\d+$/, ""));

/** { lines, fns: [{ name, line, lines, component }] } for one source file. */
export function measureSource(path, src) {
  const { program, comments, errors } = parseSync(path, src);
  if (errors.length) throw new Error(`${path}: parse error: ${errors[0].message}`);
  const flags = codeLineFlags(src, comments);
  const lineOf = lineIndexer(src);
  const count = (from, to) => flags.slice(from, to + 1).filter(Boolean).length;
  const jsx = /\.[jt]sx$/.test(path);
  const fns = uniqueNames(collectFunctions(program)).map(({ name, node }) => {
    const start = lineOf(node.start);
    return { name, line: start + 1, lines: count(start, lineOf(node.end)), component: jsx && isComponentName(name) };
  });
  return { lines: flags.filter(Boolean).length, fns };
}
