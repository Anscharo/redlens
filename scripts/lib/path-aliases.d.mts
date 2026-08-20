// Declaration shim so TS consumers (vite.config.ts, vitest.config.ts) can import
// the .mjs module. Same arrangement as build-steps.d.mts.
export declare const ALIASES: Record<string, string>;
export declare function resolveAlias(spec: string): string | null;
export declare function tsconfigPaths(from?: string): Record<string, string[]>;
