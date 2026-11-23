import { useCallback, useEffect, useRef, useState } from 'react';
import {
  optimizeImageBatch,
  type ImageOptimizationBatchSelection,
  type ImageOptimizationBatchResult,
} from '@services/conversations/data/image-optimization-batch';

export type ImageOptimizationBatchStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error';

export function useStorageImageBatch() {
  const [status, setStatus] = useState<ImageOptimizationBatchStatus>('idle');
  const [result, setResult] = useState<ImageOptimizationBatchResult | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const start = useCallback(async (selection: ImageOptimizationBatchSelection[]) => {
    if (!mountedRef.current || abortRef.current || selection.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setResult(null);
    setError('');
    try {
      const finished = await optimizeImageBatch(selection, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (mountedRef.current && abortRef.current === controller) setResult(progress);
        },
      });
      if (!mountedRef.current || abortRef.current !== controller) return;
      setResult(finished);
      setStatus(finished.cancelled ? 'cancelled' : 'completed');
    } catch (cause) {
      if (!mountedRef.current || abortRef.current !== controller) return;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (!abortRef.current || abortRef.current.signal.aborted) return;
    abortRef.current.abort();
    setStatus('cancelling');
  }, []);

  useEffect(() => {
    const abort = abortRef;
    const mounted = mountedRef;
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      abort.current = null;
    };
  }, []);

  return { status, result, error, start, cancel };
}
