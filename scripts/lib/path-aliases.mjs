// The repo's import path aliases, declared once.
//
// Several places need to agree on these: every tsconfig that resolves `@/`
// (tsconfig.test.json plus apps/web's app + test configs), apps/web's
// vite.config.ts and the root vitest.config.ts (`resolve.alias`), and
// check-boundaries.mjs, which walks the import graph and would otherwise treat
// an aliased specifier as an unresolvable bare package — a silent false
// negative in a gate whose whole job is catching what crosses a boundary.
//
// The JS consumers import this file; the tsconfigs cannot, so
// scripts_tests/path-aliases.test.ts asserts them against it. Same arrangement
// as build-steps.mjs and for the same reason: make a divergence loud.
//
// `@/` is deliberate. Every other convention (`@lib/`, `@src/`, `@lens/`) reads
// as an npm scope and can collide with a real one; `@/` cannot, because a scope
// name can never be empty.

/** @type {Record<string, string>} Alias prefix -> repo-relative directory. */
export const ALIASES = {
  "@/": "src/",
};

/**
 * Repo-relative path for an aliased specifier, or null if it isn't aliased.
 * @param {string} spec
 * @returns {string | null}
 */
export function resolveAlias(spec) {
  for (const [prefix, target] of Object.entries(ALIASES)) {
    if (spec.startsWith(prefix)) return target + spec.slice(prefix.length);
  }
  return null;
}

/**
 * tsconfig `paths` shape, for the config files and the test that checks them.
 * `from` is the tsconfig's directory relative to the repo root — apps/web sits
 * two levels down and so points back up, while the root configs point at "./".
 * @param {string} [from] e.g. "." or "apps/web"
 */
export function tsconfigPaths(from = ".") {
  const up = from === "." ? "./" : from.split("/").map(() => "../").join("");
  return Object.fromEntries(
    Object.entries(ALIASES).map(([prefix, target]) => [`${prefix}*`, [`${up}${target}*`]]),
  );
}
