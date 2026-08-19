export const APP_READ_MARKDOWN: readonly string[];
export function normalizeRepoPath(file: string): string;
export function isMarkdownPath(file: string): boolean;
export function isAppReadMarkdown(file: string): boolean;
export function isDeployRelevant(file: string): boolean;
export function shouldSkipDeploy(files: string[]): boolean;
export function prNumberFromRailwayEnv(envName: string): number | null;
export function railwayWebWatchPatterns(): string[];
export function railwayWorkerWatchPatterns(): string[];
