import { useCallback, useEffect, useRef, useState } from 'react';
import { scanDuplicateImageAssets, type DuplicateImageReport } from '@services/insight/image-duplicates';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';

type DuplicateStatus = 'idle' | 'running' | 'ready' | 'cancelled' | 'stale' | 'error';

export function useStorageDuplicates(assets: readonly StorageAssetInfo[], scanValid: boolean) {
  const [status, setStatus] = useState<DuplicateStatus>('idle');
  const [report, setReport] = useState<DuplicateImageReport | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const cancel = useCallback(() => {
    ++generationRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus('cancelled');
  }, []);

  const start = useCallback(() => {
    if (!mountedRef.current || !scanValid) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setStatus('running');
    setProgress(null);
    setError('');
    void scanDuplicateImageAssets(assets, {
      signal: controller.signal,
      onProgress: (next) => {
        if (mountedRef.current && generation === generationRef.current && !controller.signal.aborted) {
          setProgress(next);
        }
      },
    })
      .then((next) => {
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return;
        setReport(next);
        setStatus('ready');
      })
      .catch((cause) => {
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
  }, [assets, scanValid]);

  useEffect(() => {
    if (scanValid) return;
    ++generationRef.current;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((current) => (current === 'idle' ? current : 'stale'));
  }, [scanValid]);

  useEffect(() => {
    const controller = controllerRef;
    const mounted = mountedRef;
    const generation = generationRef;
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++generation.current;
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  return { status, report, progress, error, start, cancel };
}
