// A tiny in-memory event channel: `emit` calls every current subscriber with
// the payload; `subscribe` returns its own unsubscribe.

export interface Channel<T> {
  emit(payload: T): void;
  subscribe(listener: (payload: T) => void): () => void;
}

export function createChannel<T>(): Channel<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    emit(payload) {
      for (const l of listeners) l(payload);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
