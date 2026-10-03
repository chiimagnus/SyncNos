import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import { renderedElementText } from '@collectors/collector-utils.ts';
import { normalizeNotionId } from '@services/shared/notion-id';
import {
  buildNotionAiTranscriptSnapshot,
  createNotionAiTranscriptBridge,
} from '@collectors/notionai/notionai-transcript.ts';

type PreparedNotionAiCapture = {
  __notionAiTranscript: true;
  threadId: string;
  state: {
    pages: any[];
    complete: boolean;
  };
};

export function createNotionAiCollectorDef(env: CollectorEnv): CollectorDefinition {
  const transcriptBridge = createNotionAiTranscriptBridge({ window: env.window });

  function isNotionWebHost(hostname: unknown): boolean {
    const host = String(hostname || '')
      .trim()
      .toLowerCase();
    return (
      host === 'notion.so' ||
      host.endsWith('.notion.so') ||
      host === 'app.notion.com' ||
      host.endsWith('.app.notion.com')
    );
  }

  function findThreadIdFromLocation(loc: Pick<Location, 'hostname' | 'pathname' | 'href'> = env.location): string {
    if (!isNotionWebHost(loc?.hostname)) return '';
    if (String(loc?.pathname || '') !== '/chat') return '';
    try {
      return normalizeNotionId(new URL(String(loc.href || ''), 'https://app.notion.com').searchParams.get('t'));
    } catch (_error) {
      return '';
    }
  }

  function matches(loc: any): boolean {
    return !!findThreadIdFromLocation(loc || env.location);
  }

  function isCaptureAvailable(): boolean {
    return !!findThreadIdFromLocation(env.location);
  }

  function getRoot(): Element | null {
    if (!isCaptureAvailable()) return null;
    return (
      env.document.querySelector('#notion-app') ||
      env.document.querySelector('.layout-chat') ||
      env.document.documentElement ||
      env.document.body
    );
  }

  function findConversationTitle(): string {
    const scope = env.document.querySelector('[data-agent-chat-survey-shortcut-scope="true"]');
    if (!scope) return '';

    const historyButton = scope.querySelector('[role="button"][aria-label="Chat history"][aria-haspopup="dialog"]');
    if (!historyButton) return '';

    const candidates = Array.from(
      scope.querySelectorAll(
        'div[data-popup-origin="true"] > [role="button"][aria-haspopup="dialog"]:not([aria-label])',
      ),
    );
    const titleButton = candidates.find((candidate) => {
      let ancestor: Element | null = candidate.parentElement;
      for (let depth = 0; depth < 6 && ancestor && ancestor !== scope; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.contains(historyButton)) return true;
      }
      return false;
    });
    return renderedElementText(titleButton);
  }

  function preparedCapture(value: unknown, expectedThreadId: string): PreparedNotionAiCapture | null {
    const input = value as Partial<PreparedNotionAiCapture> | null;
    if (!input || input.__notionAiTranscript !== true) return null;
    if (normalizeNotionId(input.threadId) !== expectedThreadId) return null;
    const state = input.state;
    if (!state || !Array.isArray(state.pages) || !state.pages.length) return null;
    return {
      __notionAiTranscript: true,
      threadId: expectedThreadId,
      state: {
        pages: state.pages,
        complete: state.complete === true,
      },
    };
  }

  async function prepareManualCapture(): Promise<PreparedNotionAiCapture | null> {
    const threadId = findThreadIdFromLocation(env.location);
    if (!threadId) return null;
    const state = await transcriptBridge.requestFull(threadId);
    if (!state?.pages?.length) return null;
    if (findThreadIdFromLocation(env.location) !== threadId) return null;
    return {
      __notionAiTranscript: true,
      threadId,
      state,
    };
  }

  async function capture(options: any = {}): Promise<any | null> {
    const threadId = findThreadIdFromLocation(env.location);
    if (!threadId) return null;

    const state =
      options?.manual === true
        ? preparedCapture(options?.preparedCapture, threadId)?.state || null
        : await transcriptBridge.requestLatest(threadId);
    if (!state?.pages?.length) return null;
    if (findThreadIdFromLocation(env.location) !== threadId) return null;

    return buildNotionAiTranscriptSnapshot({
      ...state,
      threadId,
      conversationTitle: findConversationTitle(),
      document: env.document,
    });
  }

  const collector: any = {
    capture,
    prepareManualCapture,
    isCaptureAvailable,
    getRoot,
    __test: {
      matches,
      findThreadIdFromLocation,
      findConversationTitle,
    },
  };

  return {
    id: 'notionai',
    matches,
    inpageMatches: matches,
    collector,
  };
}
