import { storageSet } from '@platform/storage/local';

export const DATA_REVISION_WAKE_STORAGE_KEY = 'webclipper_data_revision_wake_v1' as const;

let publishActive = false;
let publishTrailing = false;
let nonceSequence = 0;
const listeners = new Set<{ listener: () => void }>();

function nextWakeNonce(): string {
  nonceSequence += 1;
  return `${Date.now()}:${nonceSequence}:${Math.random().toString(36).slice(2)}`;
}

async function flushWake(): Promise<void> {
  try {
    do {
      publishTrailing = false;
      try {
        await Promise.resolve().then(() =>
          storageSet({
            [DATA_REVISION_WAKE_STORAGE_KEY]: nextWakeNonce(),
          }),
        );
      } catch (_error) {
        // Best effort only. The authoritative IndexedDB transaction has already committed.
      }
    } while (publishTrailing);
  } finally {
    publishActive = false;
  }
}

export function publishDataRevisionWake(): void {
  for (const subscription of Array.from(listeners)) {
    try {
      subscription.listener();
    } catch (_error) {
      // Wake delivery is isolated per listener; one consumer failure must not block the others.
    }
  }
  if (publishActive) {
    publishTrailing = true;
    return;
  }
  publishActive = true;
  void flushWake();
}

export function subscribeDataRevisionWake(listener: () => void): () => void {
  if (typeof listener !== 'function') return () => {};
  const subscription = { listener };
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
}
