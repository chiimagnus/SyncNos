import { useCallback, useEffect, useRef, useState } from 'react';

import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';
import { collectOrderedSyncnosAssetIds } from '@services/shared/markdown-asset-refs';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}

function collectAssetIds(markdowns: readonly string[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const markdown of markdowns) {
    for (const id of collectOrderedSyncnosAssetIds(String(markdown || ''))) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function safeConversationId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

type ResolvedAssetSource = {
  url: string;
  objectUrl: boolean;
};

const EMPTY_ASSET_SRC_MAP: ReadonlyMap<number, string> = new Map();

export function useSyncnosAssetSrcMap(input: {
  conversationId?: number | null;
  markdowns: readonly string[];
}): ReadonlyMap<number, string> {
  const conversationId = safeConversationId(input.conversationId);
  const assetIds = collectAssetIds(Array.isArray(input.markdowns) ? input.markdowns : []);
  const identityKey = `${conversationId ?? 0}:${assetIds.join(',')}`;

  const mountedRef = useRef(false);
  const readyRef = useRef(false);
  const generationRef = useRef(0);
  const identityKeyRef = useRef('');
  const latestConversationIdRef = useRef<number | null>(conversationId);
  const latestAssetIdsRef = useRef<number[]>(assetIds);
  const inFlightRef = useRef(false);
  const trailingRef = useRef(false);
  const assetSrcRef = useRef<Map<number, string>>(new Map());
  const objectUrlByIdRef = useRef<Map<number, string>>(new Map());
  const assetSourceConversationIdRef = useRef<number | null>(conversationId);
  const [assetSrcById, setAssetSrcById] = useState<Map<number, string>>(() => new Map());

  if (identityKeyRef.current !== identityKey) {
    identityKeyRef.current = identityKey;
    generationRef.current += 1;
  }
  latestConversationIdRef.current = conversationId;
  latestAssetIdsRef.current = assetIds;
  const assetSourceMatchesConversation = assetSourceConversationIdRef.current === conversationId;

  const resolveCurrent = useCallback(async () => {
    const generation = generationRef.current;
    const currentConversationId = latestConversationIdRef.current;
    const currentAssetIds = [...latestAssetIdsRef.current];
    const currentAssetIdSet = new Set(currentAssetIds);
    const resolved = new Map<number, ResolvedAssetSource | null>();
    const newlyCreatedObjectUrls: string[] = [];
    let readFailed = false;

    const discardCreatedUrls = () => {
      for (const url of newlyCreatedObjectUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch (_error) {
          // Revocation is best-effort; stale object URLs are already detached from the committed map.
        }
      }
    };

    let assets = new Map<number, ImageCacheAsset>();
    if (currentAssetIds.length) {
      try {
        assets = await getImageCacheAssetsByIds({ ids: currentAssetIds, conversationId: currentConversationId });
      } catch (_error) {
        if (!mountedRef.current || generation !== generationRef.current) {
          discardCreatedUrls();
          return;
        }
        readFailed = true;
        assets = new Map();
      }
    }

    if (!mountedRef.current || generation !== generationRef.current) {
      discardCreatedUrls();
      return;
    }

    if (!readFailed) {
      for (const id of currentAssetIds) {
        const asset = assets.get(id);
        if (!asset) {
          resolved.set(id, null);
          continue;
        }

        try {
          let url = '';
          let objectUrl = false;
          try {
            if (typeof URL?.createObjectURL === 'function') {
              url = URL.createObjectURL(asset.blob);
              objectUrl = Boolean(url);
              if (objectUrl) newlyCreatedObjectUrls.push(url);
            }
          } catch (_error) {
            url = '';
            objectUrl = false;
          }
          if (!url) url = await blobToDataUrl(asset.blob);
          if (!mountedRef.current || generation !== generationRef.current) {
            discardCreatedUrls();
            return;
          }
          resolved.set(id, { url, objectUrl });
        } catch (_error) {
          if (!mountedRef.current || generation !== generationRef.current) {
            discardCreatedUrls();
            return;
          }
          readFailed = true;
        }
      }
    }

    if (!mountedRef.current || generation !== generationRef.current) {
      discardCreatedUrls();
      return;
    }

    const previousSources = assetSrcRef.current;
    const previousObjectUrls = objectUrlByIdRef.current;
    const nextSources = new Map<number, string>();
    const nextObjectUrls = new Map<number, string>();

    for (const id of currentAssetIds) {
      if (!currentAssetIdSet.has(id)) continue;
      if (!resolved.has(id)) {
        const previous = previousSources.get(id);
        if (previous) nextSources.set(id, previous);
        const previousObjectUrl = previousObjectUrls.get(id);
        if (previousObjectUrl) nextObjectUrls.set(id, previousObjectUrl);
        continue;
      }

      const result = resolved.get(id);
      if (!result) continue;
      nextSources.set(id, result.url);
      if (result.objectUrl) nextObjectUrls.set(id, result.url);
    }

    for (const [id, oldUrl] of previousObjectUrls) {
      if (nextObjectUrls.get(id) === oldUrl) continue;
      try {
        URL.revokeObjectURL(oldUrl);
      } catch (_error) {
        // Revocation is best-effort; this URL is no longer referenced by the committed source map.
      }
    }

    assetSrcRef.current = nextSources;
    objectUrlByIdRef.current = nextObjectUrls;
    setAssetSrcById(nextSources);

    if (readFailed && mountedRef.current && generation === generationRef.current) {
      requestDataRevisionRetry(['image_cache']);
    }
  }, []);

  const requestResolve = useCallback(() => {
    if (!mountedRef.current || !readyRef.current) return;
    if (inFlightRef.current) {
      trailingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    void resolveCurrent().finally(() => {
      inFlightRef.current = false;
      if (!mountedRef.current || !readyRef.current || !trailingRef.current) return;
      trailingRef.current = false;
      requestResolve();
    });
  }, [resolveCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeDataRevisionChanges((scopes) => {
      if (!scopes.includes('image_cache')) return;
      generationRef.current += 1;
      requestResolve();
    });

    void whenDataRevisionObserverReady().then(() => {
      if (!mountedRef.current) return;
      readyRef.current = true;
      requestResolve();
    });

    return () => {
      mountedRef.current = false;
      readyRef.current = false;
      generationRef.current += 1;
      trailingRef.current = false;
      unsubscribe();
      for (const url of objectUrlByIdRef.current.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch (_error) {
          // Revocation is best-effort; stale object URLs are already detached from the committed map.
        }
      }
      objectUrlByIdRef.current = new Map();
      assetSrcRef.current = new Map();
    };
  }, [requestResolve]);

  useEffect(() => {
    if (assetSourceConversationIdRef.current === conversationId) return;
    assetSourceConversationIdRef.current = conversationId;
    for (const url of objectUrlByIdRef.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (_error) {
        // Revocation is best-effort; this URL belongs to the previous conversation and is no longer renderable.
      }
    }
    objectUrlByIdRef.current = new Map();
    assetSrcRef.current = new Map();
    setAssetSrcById(new Map());
  }, [conversationId]);

  useEffect(() => {
    requestResolve();
  }, [identityKey, requestResolve]);

  return assetSourceMatchesConversation ? assetSrcById : EMPTY_ASSET_SRC_MAP;
}
