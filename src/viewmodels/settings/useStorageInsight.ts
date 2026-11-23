import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getStorageOverview,
  scanStorageAssets,
  type StorageAssetScan,
  type StorageOverview,
} from '@services/insight/storage-insight-source';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';

type LoadStatus = 'loading' | 'ready' | 'error';
type ScanStatus = 'idle' | 'running' | 'ready' | 'stale' | 'cancelled' | 'error';

export function useStorageInsight() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState('');
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanError, setScanError] = useState('');
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(null);
  const [scanData, setScanData] = useState<StorageAssetScan | null>(null);
  const scanGenerationRef = useRef(0);
  const scanControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const startScan = useCallback(() => {
    if (!mountedRef.current) return;
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++scanGenerationRef.current;
    scanControllerRef.current = controller;
    setScanStatus('running');
    setScanProgress(null);
    setScanError('');

    void scanStorageAssets({
      signal: controller.signal,
      onProgress: (progress) => {
        if (mountedRef.current && generation === scanGenerationRef.current && !controller.signal.aborted) {
          setScanProgress(progress);
        }
      },
    })
      .then((data) => {
        if (!mountedRef.current || generation !== scanGenerationRef.current || controller.signal.aborted) return;
        setScanData(data);
        setScanStatus('ready');
      })
      .catch((cause) => {
        if (!mountedRef.current || generation !== scanGenerationRef.current || controller.signal.aborted) return;
        setScanStatus('error');
        setScanError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (scanControllerRef.current === controller) scanControllerRef.current = null;
      });
  }, []);

  const cancelScan = useCallback(() => {
    ++scanGenerationRef.current;
    scanControllerRef.current?.abort();
    scanControllerRef.current = null;
    setScanStatus('cancelled');
  }, []);

  useEffect(() => {
    const scanGeneration = scanGenerationRef;
    const scanController = scanControllerRef;
    mountedRef.current = true;
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
      if (scopes.includes('image_cache')) {
        version += 1;
        read();
      }
      if (scopes.includes('image_cache') || scopes.includes('conversations')) {
        ++scanGenerationRef.current;
        scanControllerRef.current?.abort();
        scanControllerRef.current = null;
        setScanStatus((value) => (value === 'idle' ? value : 'stale'));
      }
    });
    void whenDataRevisionObserverReady().then(() => {
      if (!active) return;
      ready = true;
      read();
    });
    return () => {
      active = false;
      mountedRef.current = false;
      version += 1;
      ++scanGeneration.current;
      scanController.current?.abort();
      scanController.current = null;
      unsubscribe();
    };
  }, []);

  return { overview, status, error, scanData, scanStatus, scanProgress, scanError, startScan, cancelScan };
}
