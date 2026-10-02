// The shape of one environment variable declaration. Every variable the server,
// the atlas worker, the build scripts or `pnpm dev` reads is declared once, in a
// group file in this directory; `.env.example` is rendered from these
// declarations (`pnpm env:example`) and env.test.ts fails on any drift.

export interface EnvVar {
  name: string;
  /** What the variable controls, in present tense. Rendered as comment lines. */
  doc: string;
  /** The value the code uses when the variable is unset. Omitted means unset or empty. */
  default?: string;
  /**
   * A value worth setting, printed as an uncommented line. Set it only for
   * variables a deployment normally configures; everything else stays commented.
   */
  example?: string;
}

export interface EnvGroup {
  title: string;
  note?: string;
  vars: EnvVar[];
}
