import {
  getConversationBySourceConversationKey,
  hasConversation,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage';
import { buildCanonicalWebArticleIdentity, WEB_ARTICLE_SOURCE } from '@services/conversations/domain/article-identity';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { DISCOURSE_OP_MISSING_WARNING_FLAG, DISCOURSE_OP_NOT_FOUND_ERROR } from '@collectors/web/article-fetch-errors';
import { canonicalizeArticleUrl, normalizeHttpUrl } from '@services/url-cleaning/http-url';
import { scriptingExecuteScript } from '@platform/webext/scripting';
import { tabsGet, tabsQuery, tabsSendMessage, tabsUpdate } from '@platform/webext/tabs';
import { storageGet } from '@platform/storage/local';
import { getAntiHotlinkRulesSnapshot, includesAnyAntiHotlinkDomain } from '@platform/webext/anti-hotlink-rules-store';
import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  buildDiscourseTopicFloorUrl,
  isSameDiscourseTopicFloorUrl,
  parseDiscourseTopicUrl,
} from '@collectors/web/article-fetch-discourse';

async function hasAntiHotlinkImages(markdown: string): Promise<boolean> {
  try {
    const rules = await getAntiHotlinkRulesSnapshot();
    return includesAnyAntiHotlinkDomain(markdown, rules);
  } catch (error) {
    console.warn('[ArticleFetch] anti-hotlink rules unavailable, skip forced image cache', {
      error: error instanceof Error ? error.message : String(error || ''),
    });
    return false;
  }
}

const ARTICLE_SOURCE_TYPE = 'article';
const READABILITY_FILE = 'src/vendor/readability.js';
const DISCOURSE_NAVIGATION_WAIT_TIMEOUT_MS = 10_000;
const ARTICLE_STABILIZATION_TIMEOUT_MS = 10_000;
const ARTICLE_STABILIZATION_MIN_TEXT_LENGTH = 240;
const CONTENT_MESSAGE_RETRY_DELAY_MS = 320;
const XIAOHONGSHU_COMMENTS_CAPTURE_ENABLED_STORAGE_KEY = 'xiaohongshu_comments_capture_enabled';

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}

function normalizeText(text: unknown) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function hasWarningFlag(warningFlags: unknown, flag: string): boolean {
  if (!Array.isArray(warningFlags)) return false;
  return warningFlags.some((item) => String(item || '').trim() === flag);
}

async function waitForTabUrl(targetTabId: number, expectedUrl: string, timeoutMs = 8_000): Promise<string> {
  const expected = normalizeHttpUrl(expectedUrl);
  if (!expected) throw toError('invalid expected navigation url');

  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 8_000);
  while (Date.now() < deadline) {
    const tab = await tabsGet(targetTabId);
    const current = normalizeHttpUrl((tab as any)?.url || '');
    if (current === expected || isSameDiscourseTopicFloorUrl(current, expected)) return current;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw toError('timed out waiting for Discourse /1 navigation');
}

function fallbackTitle(url: string, tabTitle: unknown) {
  const preferred = normalizeText(tabTitle);
  if (preferred) return preferred;
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch (_e) {
    return url;
  }
}

async function resolveTargetTab(tabId?: number) {
  if (Number.isFinite(Number(tabId)) && Number(tabId) > 0) {
    const tab = await tabsGet(Number(tabId));
    if (!tab || !Number.isFinite(Number(tab.id))) throw toError('target tab not found');
    return tab;
  }

  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  if (!tab || !Number.isFinite(Number(tab.id))) throw toError('active tab not found');
  return tab;
}

async function ensureReadability(tabId: number) {
  try {
    await scriptingExecuteScript({
      target: { tabId, allFrames: false },
      files: [READABILITY_FILE],
    });
  } catch (error) {
    // Readability is a best-effort enhancement. Extraction still works via site-spec/readability-missing fallbacks.
    console.warn('[ArticleFetch] inject readability failed, continue without it', {
      tabId,
      error: error instanceof Error ? error.message : String(error || ''),
    });
  }
}

function isMissingContentReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  // port closed means a receiver existed and then tore down; do not hide it behind missing-receiver retry
  return /receiving end does not exist|no receiving end/i.test(message);
}

async function extractArticleOnTab(tabId: number, includeXiaohongshuComments: boolean) {
  const payload = {
    type: CONTENT_MESSAGE_TYPES.EXTRACT_WEB_ARTICLE,
    payload: {
      stabilizationTimeoutMs: ARTICLE_STABILIZATION_TIMEOUT_MS,
      stabilizationMinTextLength: ARTICLE_STABILIZATION_MIN_TEXT_LENGTH,
      includeXiaohongshuComments,
    },
  };

  let response: unknown = null;
  try {
    response = await tabsSendMessage(tabId, payload);
  } catch (error) {
    // Content scripts may not be ready right after navigation; retry once to reduce flaky "no receiver" failures.
    if (isMissingContentReceiverError(error)) {
      await sleep(CONTENT_MESSAGE_RETRY_DELAY_MS);
      response = await tabsSendMessage(tabId, payload);
    } else {
      throw error;
    }
  }

  if (!response) {
    await sleep(CONTENT_MESSAGE_RETRY_DELAY_MS);
    response = await tabsSendMessage(tabId, payload);
  }

  const apiResponse = response as { ok?: boolean; data?: unknown; error?: { message?: unknown } | null } | null;
  if (!apiResponse || apiResponse.ok !== true) {
    const reason = apiResponse?.error?.message
      ? String(apiResponse.error.message)
      : 'article extraction returned empty payload';
    throw toError(reason);
  }
  return apiResponse.data as any;
}

async function extractArticleOnTabWithReadabilityFallback(
  tabId: number,
  includeXiaohongshuComments: boolean,
  ensureReadabilityOnce: () => Promise<void>,
) {
  try {
    return await extractArticleOnTab(tabId, includeXiaohongshuComments);
  } catch (_error) {
    await ensureReadabilityOnce();
    return await extractArticleOnTab(tabId, includeXiaohongshuComments);
  }
}

async function shouldCaptureXiaohongshuComments(): Promise<boolean> {
  try {
    const local = await storageGet([XIAOHONGSHU_COMMENTS_CAPTURE_ENABLED_STORAGE_KEY]);
    return local?.[XIAOHONGSHU_COMMENTS_CAPTURE_ENABLED_STORAGE_KEY] === true;
  } catch (_error) {
    return false;
  }
}

export async function fetchActiveTabArticle({ tabId }: { tabId?: number } = {}) {
  const tab = await resolveTargetTab(tabId);
  const targetTabId = Number(tab.id);
  const normalizedUrl = normalizeHttpUrl(tab.url || '');
  if (!normalizedUrl) throw toError('active tab must be an http(s) page');
  const discourseTopic = parseDiscourseTopicUrl(normalizedUrl);
  const canonicalUrl = canonicalizeArticleUrl(normalizedUrl) || normalizedUrl;
  const includeXiaohongshuComments = await shouldCaptureXiaohongshuComments();

  let readabilityInjected = false;
  const ensureReadabilityOnce = async () => {
    if (readabilityInjected) return;
    readabilityInjected = true;
    await ensureReadability(targetTabId);
  };
  let extracted = await extractArticleOnTabWithReadabilityFallback(
    targetTabId,
    includeXiaohongshuComments,
    ensureReadabilityOnce,
  );

  const shouldFallbackToFirstFloor =
    discourseTopic &&
    hasWarningFlag((extracted as any)?.warningFlags, DISCOURSE_OP_MISSING_WARNING_FLAG) &&
    discourseTopic.postNumber !== 1 &&
    (discourseTopic.postNumber != null || discourseTopic.postSegment != null);

  if (shouldFallbackToFirstFloor) {
    const firstFloorUrl = buildDiscourseTopicFloorUrl(discourseTopic, 1);
    await tabsUpdate(targetTabId, { url: firstFloorUrl });
    await waitForTabUrl(targetTabId, firstFloorUrl, DISCOURSE_NAVIGATION_WAIT_TIMEOUT_MS);
    extracted = await extractArticleOnTabWithReadabilityFallback(
      targetTabId,
      includeXiaohongshuComments,
      ensureReadabilityOnce,
    );
  }

  if (discourseTopic && hasWarningFlag((extracted as any)?.warningFlags, DISCOURSE_OP_MISSING_WARNING_FLAG)) {
    throw toError(DISCOURSE_OP_NOT_FOUND_ERROR);
  }

  const textContent = normalizeText(extracted.textContent || '');
  const markdownContent = normalizeText(extracted.contentMarkdown || '');
  const title = normalizeText(extracted.title || '') || fallbackTitle(canonicalUrl, tab.title || '');
  const author = normalizeText(extracted.author || '');
  const publishedAt = normalizeText(extracted.publishedAt || '');
  const warningFlags = Array.isArray(extracted.warningFlags)
    ? extracted.warningFlags.map((item: any) => String(item || '').trim()).filter(Boolean)
    : [];

  if (!textContent) throw toError('No article content detected');

  const capturedAt = Date.now();
  let existed = false;
  try {
    existed = await hasConversation({
      sourceType: ARTICLE_SOURCE_TYPE,
      source: WEB_ARTICLE_SOURCE,
      conversationKey: buildCanonicalWebArticleIdentity(canonicalUrl)?.conversationKey || '',
      url: canonicalUrl,
    });
  } catch (_e) {
    existed = false;
  }
  const conversation = await upsertConversation({
    sourceType: ARTICLE_SOURCE_TYPE,
    source: WEB_ARTICLE_SOURCE,
    conversationKey: buildCanonicalWebArticleIdentity(canonicalUrl)?.conversationKey || '',
    title,
    url: canonicalUrl,
    author,
    publishedAt,
    warningFlags,
    lastCapturedAt: capturedAt,
  });

  const body = textContent;
  const markdown = markdownContent || body;
  const conversationId = Number((conversation as any).id);
  let messagesToSave = [
    {
      messageKey: 'article_body',
      role: 'article',
      contentText: body,
      contentMarkdown: markdown,
      sequence: 1,
      updatedAt: capturedAt,
    },
  ];

  try {
    const local = await storageGet(['web_article_cache_images_enabled']);
    const hasAntiHotlink = await hasAntiHotlinkImages(markdown);
    const shouldCacheImages = local?.web_article_cache_images_enabled === true || hasAntiHotlink;

    if (shouldCacheImages) {
      const inlined = await inlineChatImagesInMessages({
        conversationId,
        conversationUrl: canonicalUrl,
        messages: messagesToSave,
        enableHttpImages: true,
      });
      messagesToSave = inlined.messages;

      if (hasAntiHotlink && !local?.web_article_cache_images_enabled) {
        console.info('[ArticleFetch] auto-caching anti-hotlink images (user setting is off)', {
          conversationId,
          url: canonicalUrl,
        });
      }

      if (
        inlined.inlinedCount > 0 ||
        inlined.downloadedCount > 0 ||
        inlined.fromCacheCount > 0 ||
        (Array.isArray(inlined.warningFlags) && inlined.warningFlags.length)
      ) {
        console.info('[ImageInline][ArticleFetch]', {
          conversationId,
          inlinedCount: inlined.inlinedCount,
          downloadedCount: inlined.downloadedCount,
          fromCacheCount: inlined.fromCacheCount,
          inlinedBytes: inlined.inlinedBytes,
          warningFlags: inlined.warningFlags,
        });
      }
    }
  } catch (error) {
    console.warn('[ImageInline][ArticleFetch] failed but capture continues', {
      conversationId,
      error: error instanceof Error ? error.message : String(error || ''),
    });
  }

  await syncConversationMessages(conversationId, messagesToSave);

  return {
    isNew: !existed,
    conversationId,
    url: canonicalUrl,
    title,
    author,
    publishedAt,
    warningFlags,
    lastCapturedAt: capturedAt,
  };
}

export async function resolveOrCaptureActiveTabArticle({ tabId }: { tabId?: number } = {}) {
  const tab = await resolveTargetTab(tabId);
  const normalizedUrl = normalizeHttpUrl(tab.url || '');
  if (!normalizedUrl) throw toError('active tab must be an http(s) page');
  const canonicalUrl = canonicalizeArticleUrl(normalizedUrl) || normalizedUrl;

  const key = buildCanonicalWebArticleIdentity(canonicalUrl)?.conversationKey || '';
  try {
    const existing = await getConversationBySourceConversationKey(WEB_ARTICLE_SOURCE, key);
    const existingId = Number((existing as any)?.id);
    if (existing && Number.isFinite(existingId) && existingId > 0) {
      const warningFlags = Array.isArray((existing as any)?.warningFlags)
        ? (existing as any).warningFlags.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [];
      return {
        isNew: false,
        conversationId: existingId,
        url: canonicalUrl,
        title: normalizeText((existing as any)?.title || '') || fallbackTitle(canonicalUrl, (tab as any)?.title || ''),
        author: normalizeText((existing as any)?.author || ''),
        publishedAt: normalizeText((existing as any)?.publishedAt || ''),
        warningFlags,
        lastCapturedAt: Number((existing as any)?.lastCapturedAt) || null,
      };
    }
  } catch (_e) {
    // ignore and fallback to capture
  }

  return await fetchActiveTabArticle({ tabId: Number((tab as any)?.id) });
}
