import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationMessage } from '@services/conversations/domain/models';
import {
  getConversationStorageDetails,
  type ConversationStorageDetails,
} from '@services/conversations/data/conversation-storage';
import {
  optimizeConversationImages,
  type ConversationOptimizationProgress,
} from '@services/conversations/data/conversation-image-optimization';
import { subscribeDataRevisionChanges } from '@services/data-revisions/observer';

type Inspection = {
  conversationId: number;
  messages: readonly ConversationMessage[];
  status: 'loading' | 'ready' | 'error';
  details: ConversationStorageDetails | null;
  error: string;
};

type Optimization = {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: ConversationOptimizationProgress | null;
  error: string;
};

const EMPTY_OPTIMIZATION: Optimization = { status: 'idle', progress: null, error: '' };

export function useConversationStorage(input: { conversationId: number; messages: readonly ConversationMessage[] }) {
  const { conversationId, messages } = input;
  const [revision, setRevision] = useState(0);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [optimization, setOptimization] = useState<Optimization>(EMPTY_OPTIMIZATION);
  const inFlightRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(false);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = subscribeDataRevisionChanges((scopes) => {
      if (scopes.includes('image_cache') || scopes.includes('messages') || scopes.includes('conversations')) refresh();
    });
    return () => {
      aliveRef.current = false;
      inFlightRef.current?.abort();
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setInspection({ conversationId, messages, status: 'loading', details: null, error: '' });
    void getConversationStorageDetails({ conversationId, messages, signal: controller.signal }).then(
      (details) => {
        if (!controller.signal.aborted) {
          setInspection({ conversationId, messages, status: 'ready', details, error: '' });
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          setInspection({ conversationId, messages, status: 'error', details: null, error: String(error) });
        }
      },
    );
    return () => controller.abort();
  }, [conversationId, messages, revision]);

  useEffect(() => {
    setOptimization(EMPTY_OPTIMIZATION);
    return () => inFlightRef.current?.abort();
  }, [conversationId]);

  const details =
    inspection?.conversationId === conversationId && inspection.messages === messages ? inspection.details : null;
  const status =
    inspection?.conversationId === conversationId && inspection.messages === messages ? inspection.status : 'loading';

  const optimize = useCallback(async () => {
    if (inFlightRef.current || !details) return;
    const ids = details.images.filter((asset) => asset.optimizable).map((asset) => asset.id);
    if (!ids.length) return;
    const controller = new AbortController();
    inFlightRef.current = controller;
    setOptimization({
      status: 'running',
      progress: {
        processed: 0,
        total: ids.length,
        optimized: 0,
        bytesSaved: 0,
        cancelled: false,
      },
      error: '',
    });
    try {
      const result = await optimizeConversationImages({
        conversationId,
        ids,
        signal: controller.signal,
        onProgress: (progress) => {
          if (aliveRef.current) setOptimization({ status: 'running', progress, error: '' });
        },
      });
      if (aliveRef.current) {
        setOptimization({ status: 'done', progress: result, error: '' });
        refresh();
      }
    } catch (error) {
      if (aliveRef.current) {
        setOptimization({
          status: 'error',
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        });
        refresh();
      }
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }, [conversationId, details, refresh]);

  const cancel = useCallback(() => inFlightRef.current?.abort(), []);

  return { status, details, error: inspection?.error || '', refresh, optimization, optimize, cancel };
}
