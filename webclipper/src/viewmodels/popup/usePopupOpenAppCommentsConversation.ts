import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ARTICLE_MESSAGE_TYPES, UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { openOrFocusExtensionAppTab } from '@services/shared/webext';
import { encodeConversationLoc, buildConversationRouteFromLoc } from '@services/shared/conversation-loc';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { t } from '@i18n';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

type CaptureState = {
  available: boolean;
  kind: 'chat' | 'article' | 'unsupported';
  label: string;
  collectorId: string | null;
  reason?: string;
};

type ResolvedArticle = {
  conversationId: number;
  url: string | null;
  title: string | null;
};

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('no response from background');
  }
  if (response.ok) return response.data as T;
  throw new Error(response.error?.message || 'unknown error');
}

function hasRuntimeSendMessage(): boolean {
  const anyGlobal = globalThis as any;
  const browserSend = anyGlobal.browser?.runtime?.sendMessage;
  if (typeof browserSend === 'function') return true;
  const chromeSend = anyGlobal.chrome?.runtime?.sendMessage;
  return typeof chromeSend === 'function';
}

export function usePopupOpenAppCommentsConversation() {
  const runtimeAvailable = useMemo(() => hasRuntimeSendMessage(), []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [checking, setChecking] = useState(() => runtimeAvailable);
  const [opening, setOpening] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string>(() =>
    runtimeAvailable ? t('checkingDots') : t('commentsSidebarUnavailableHint'),
  );

  const refreshEligibility = useCallback(async () => {
    if (!runtimeAvailable) return;
    if (mountedRef.current) setChecking(true);
    try {
      const response = await send<ApiResponse<CaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
      const state = unwrap(response);

      if (!state.available) {
        if (!mountedRef.current) return;
        setEligible(false);
        setDisabledReason(t('commentsSidebarUnavailableHint'));
        return;
      }

      if (state.kind !== 'article') {
        if (!mountedRef.current) return;
        setEligible(false);
        setDisabledReason(t('commentsSidebarArticleOnlyHint'));
        return;
      }

      if (!mountedRef.current) return;
      setEligible(true);
      setDisabledReason(t('openCommentsSidebar'));
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? '');
      if (!mountedRef.current) return;
      setEligible(false);
      setDisabledReason(message || t('commentsSidebarUnavailableHint'));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [runtimeAvailable]);

  useEffect(() => {
    if (!runtimeAvailable) return;
    void refreshEligibility();
  }, [refreshEligibility, runtimeAvailable]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!runtimeAvailable) return;
    const onFocus = () => {
      void refreshEligibility();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshEligibility, runtimeAvailable]);

  const open = useCallback(async () => {
    if (!runtimeAvailable) return false;
    if (checking || opening || !eligible) return false;
    if (mountedRef.current) setOpening(true);
    try {
      const response = await send<ApiResponse<ResolvedArticle>>(
        ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB,
        {},
      );
      const resolved = unwrap(response);

      const canonicalUrl = canonicalizeArticleUrl(resolved?.url);
      if (!canonicalUrl) return false;

      const loc = encodeConversationLoc({ source: 'web', conversationKey: `article:${canonicalUrl}` });
      const route = buildConversationRouteFromLoc(loc);
      const opened = await openOrFocusExtensionAppTab({ route });
      return Boolean(opened);
    } catch (_error) {
      return false;
    } finally {
      if (mountedRef.current) setOpening(false);
    }
  }, [checking, eligible, opening, runtimeAvailable]);

  const disabled = checking || opening || !eligible;
  const tooltip = useMemo(() => {
    if (opening) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (eligible) return t('openCommentsSidebarTooltip');
    return disabledReason || t('commentsSidebarUnavailableHint');
  }, [checking, disabledReason, eligible, opening]);

  return { disabled, tooltip, open };
}
