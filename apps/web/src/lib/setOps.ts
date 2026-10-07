// Immutable Set updates for React state. Each helper returns the SAME Set when
// the update changes nothing, so `setState(prev => added(prev, id))` bails out
// of the re-render.

/** `set` with `value` present. */
export function added<T>(set: ReadonlySet<T>, value: T): Set<T> {
  if (set.has(value)) return set as Set<T>;
  return new Set(set).add(value);
}

/** `set` with `value` absent. */
export function removed<T>(set: ReadonlySet<T>, value: T): Set<T> {
  if (!set.has(value)) return set as Set<T>;
  const next = new Set(set);
  next.delete(value);
  return next;
}

/** `set` with `value` flipped. Always a new Set. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  return set.has(value) ? removed(set, value) : added(set, value);
}

/** `set` with every value present. */
export function addedAll<T>(set: ReadonlySet<T>, values: Iterable<T>): Set<T> {
  let next: Set<T> | null = null;
  for (const v of values) {
    if ((next ?? set).has(v)) continue;
    next ??= new Set(set);
    next.add(v);
  }
  return next ?? (set as Set<T>);
}
