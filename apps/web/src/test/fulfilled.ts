/** A promise React's `use()` reads synchronously. `use()` checks
 *  `promise.status` / `.value` and, when the promise is already tagged
 *  fulfilled, returns without suspending — and in the jsdom test
 *  environment the Suspense retry that would follow a real resolution never
 *  fires, so a component test that mocks a `use()`d loader hands it one of
 *  these instead of a bare `Promise.resolve`. */
export function fulfilled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}
