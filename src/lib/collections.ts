// Map-building helpers shared by the browser, the server and scripts. Keys keep
// first-seen order, which several callers rely on for deterministic output.

/** Appends `value` to the list under `key`, creating the list on first use. */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Groups items by `keyOf`; items whose key is `null`/`undefined` are skipped. */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K | null | undefined): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key != null) pushTo(out, key, item);
  }
  return out;
}

/** Counts items per key; items whose key is `null`/`undefined` are skipped. */
export function countBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K | null | undefined): Map<K, number> {
  const out = new Map<K, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key != null) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Indexes items by `keyOf`; a later item replaces an earlier one with the same key. */
export function indexBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const item of items) out.set(keyOf(item), item);
  return out;
}
