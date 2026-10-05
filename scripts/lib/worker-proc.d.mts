// Type declarations for worker-proc.mjs, so tests can import it. Runtime stays worker-proc.mjs.
export const ROOT: string;
export const SUBMODULE: string;
export function run(cmd: string, args: string[], opts?: object): void;
export function runAsync(cmd: string, args: string[], opts?: object): Promise<void>;
export function readUpstreamSha(noFetch: boolean): Promise<string | null>;
