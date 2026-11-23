import { useCallback, useEffect, useRef, useState } from 'react';

import { getImageCacheAssetById, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import {
  createImageOptimizationPreview,
  type ImageOptimizationMode,
  type ImageOptimizationPreview,
} from '@services/conversations/data/image-optimization';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { commitImageOptimization } from '@services/conversations/data/image-optimization-commit';

export type ImageOptimizationSelection = { id: number; conversationId: number };
export type PreparedImageOptimization = {
  selection: ImageOptimizationSelection;
  asset: ImageCacheAsset;
  result: Extract<ImageOptimizationPreview, { ok: true }>;
  expectedImageRevision: number;
};
export type ImageOptimizationPreviewState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export function useStorageImageOptimization(scanValid: boolean) {
  const [preview, setPreview] = useState<PreparedImageOptimization | null>(null);
  const [previewStatus, setPreviewStatus] = useState<ImageOptimizationPreviewState>('idle');
  const [previewError, setPreviewError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [savedBytes, setSavedBytes] = useState(0);
  const savingRef = useRef(false);
  const activeRef = useRef(true);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const cancelPreview = useCallback(() => {
    generationRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setPreview(null);
    setPreviewStatus('idle');
    setPreviewError('');
  }, []);

  const preparePreview = useCallback(async (selection: ImageOptimizationSelection, mode: ImageOptimizationMode) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    abortRef.current = controller;
    setPreview(null);
    setPreviewStatus('loading');
    setPreviewError('');
    setSaveStatus('idle');
    setSaveError('');
    setSavedBytes(0);

    try {
      const before = await readDataRevisionSnapshot();
      const asset = await getImageCacheAssetById(selection);
      if (!asset || controller.signal.aborted) throw new Error('asset_unavailable');
      const result = await createImageOptimizationPreview({
        blob: asset.blob,
        contentType: asset.contentType,
        mode,
        signal: controller.signal,
      });
      const after = await readDataRevisionSnapshot();
      if (!activeRef.current || generation !== generationRef.current || controller.signal.aborted) return;
      if (before.image_cache !== after.image_cache || before.conversations !== after.conversations) {
        throw new Error('storage_insight_stale');
      }
      if (!result.ok) {
        setPreviewStatus('unavailable');
        setPreviewError(result.reason);
        return;
      }
      setPreview({ selection, asset, result, expectedImageRevision: after.image_cache });
      setPreviewStatus('ready');
    } catch (error) {
      if (!activeRef.current || generation !== generationRef.current || controller.signal.aborted) return;
      setPreviewStatus('error');
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const savePreview = useCallback(
    async (approveLossy: boolean) => {
      if (!preview || savingRef.current || !scanValid || !activeRef.current) return;
      savingRef.current = true;
      setSaveStatus('saving');
      setSaveError('');
      try {
        const saved = await commitImageOptimization({
          selection: preview.selection,
          originalAsset: preview.asset,
          preview: preview.result,
          expectedRevision: preview.expectedImageRevision,
          approveLossy,
        });
        if (!activeRef.current) return;
        setSavedBytes(saved.bytesSaved);
        setSaveStatus('saved');
        setPreview(null);
        setPreviewStatus('idle');
      } catch (error) {
        if (!activeRef.current) return;
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaveStatus('error');
      } finally {
        savingRef.current = false;
      }
    },
    [preview, scanValid],
  );

  useEffect(() => {
    if (!scanValid) cancelPreview();
  }, [scanValid, cancelPreview]);

  useEffect(() => {
    const generation = generationRef;
    const abort = abortRef;
    const active = activeRef;
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
      abort.current?.abort();
      abort.current = null;
    };
  }, []);

  return {
    preview,
    previewStatus,
    previewError,
    preparePreview,
    cancelPreview,
    savePreview,
    saveStatus,
    saveError,
    savedBytes,
  };
}
