// The repo's import path aliases, declared once.
//
// Five places need to agree on these: tsconfig.app.json and tsconfig.test.json
// (`paths`), vite.config.ts and vitest.config.ts (`resolve.alias`), and
// check-boundaries.mjs, which walks the import graph and would otherwise treat
// an aliased specifier as an unresolvable bare package — a silent false
// negative in a gate whose whole job is catching what crosses a boundary.
//
// The JS consumers import this file; the two tsconfigs cannot, so
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

/** tsconfig `paths` shape, for the config files and the test that checks them. */
export function tsconfigPaths() {
  return Object.fromEntries(
    Object.entries(ALIASES).map(([prefix, target]) => [`${prefix}*`, [`./${target}*`]]),
  );
}
