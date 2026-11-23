import { useEffect, useState } from 'react';

import { getStorageOverview, type StorageOverview } from '@services/insight/storage-insight-source';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';

type LoadStatus = 'loading' | 'ready' | 'error';

export function useStorageInsight() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let ready = false;
    let version = 0;
    let reading = false;
    let trailing = false;

    const read = () => {
      if (!active || !ready) return;
      if (reading) {
        trailing = true;
        return;
      }
      const requestedVersion = version;
      reading = true;
      setStatus('loading');
      void getStorageOverview()
        .then((next) => {
          if (!active || version !== requestedVersion) return;
          setOverview(next);
          setError('');
          setStatus('ready');
        })
        .catch((cause) => {
          if (!active || version !== requestedVersion) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus('error');
          requestDataRevisionRetry(['image_cache']);
        })
        .finally(() => {
          reading = false;
          if (!active || !trailing) return;
          trailing = false;
          read();
        });
    };

    const unsubscribe = subscribeDataRevisionChanges((scopes) => {
      if (!scopes.includes('image_cache')) return;
      version += 1;
      read();
    });
    void whenDataRevisionObserverReady().then(() => {
      if (!active) return;
      ready = true;
      read();
    });
    return () => {
      active = false;
      version += 1;
      unsubscribe();
    };
  }, []);

  return { overview, status, error };
}
