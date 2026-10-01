export interface FunctionSize {
  /** Dotted scope path, e.g. `Outer.inner`; repeats get a `#n` suffix. */
  name: string;
  line: number;
  lines: number;
  component: boolean;
}

export interface SourceSize {
  lines: number;
  fns: FunctionSize[];
}

export function codeLineFlags(src: string, comments: { start: number; end: number }[]): boolean[];
export function measureSource(path: string, src: string): SourceSize;
