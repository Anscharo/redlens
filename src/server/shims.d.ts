// The build pipeline's shared helpers are untyped .mjs modules. The Railway
// server reuses a couple so behavior stays identical (e.g. entity slugging).
declare module "*/graph-patterns.mjs" {
  export function slugify(input: string): string;
}
