import { buildMentionInsertText, searchMentionCandidates } from '@services/integrations/item-mention/client';
import type { EditorAdapter, EditorHandle } from '@services/integrations/item-mention/content/editor-adapter';
import { chatgptTextareaEditorAdapter } from '@services/integrations/item-mention/content/editor-chatgpt';
import { notionAiContentEditableAdapter } from '@services/integrations/item-mention/content/editor-notionai';
import type { MentionSessionState } from '@services/integrations/item-mention/content/mention-session';
import { updateMentionSession } from '@services/integrations/item-mention/content/mention-session';
import { moveMentionHighlightIndex } from '@services/integrations/item-mention/content/mention-ui-state';
import { inpageItemMentionApi } from '@ui/inpage/inpage-item-mention-shadow';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
  onInvalidated?: (listener: (error: Error) => void) => () => void;
  isInvalidContextError?: (error: unknown) => boolean;
};

function isChatgptHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return /(^|\.)chatgpt\.com$/.test(host) || /(^|\.)chat\.openai\.com$/.test(host);
}

function isNotionHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return /(^|\.)notion\.so$/.test(host);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function computePopupPosition(el: HTMLElement): { left: number; top: number } {
  const rect = el.getBoundingClientRect();
  const vw = Math.max(1, Number(window.innerWidth) || 1);
  const vh = Math.max(1, Number(window.innerHeight) || 1);

  const left = clamp(rect.left + 8, 6, Math.max(6, vw - 380));
  const top = clamp(rect.bottom + 8, 6, Math.max(6, vh - 340));
  return { left, top };
}

export function createItemMentionController(deps: { runtime: RuntimeClient | null }) {
  const runtime = deps.runtime;

  return {
    start() {
      if (!runtime || typeof runtime.send !== 'function') return null;
      const rt: RuntimeClient = runtime;
      const hostname = location?.hostname || '';
      const pickedAdapter: EditorAdapter | null = isChatgptHost(hostname)
        ? chatgptTextareaEditorAdapter
        : isNotionHost(hostname)
          ? notionAiContentEditableAdapter
          : null;
      if (!pickedAdapter) return null;
      const adapter: EditorAdapter = pickedAdapter;

      let stopped = false;
      let session: MentionSessionState | null = null;
      let items: any[] = [];
      let lastText = '';
      let lastCursor = 0;
      let searchTimer: ReturnType<typeof setTimeout> | null = null;
      let requestSeq = 0;
      let currentQueryKey = '';
      let composing = false;
      const unsubscribeInvalidated = rt.onInvalidated?.(() => stop()) || null;

      function stopTimers() {
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = null;
        }
      }

      function hidePopup() {
        inpageItemMentionApi.render({ open: false, items: [], highlightIndex: 0, position: null, onPick: null });
      }

      function renderPopup() {
        if (!session || !session.open) return hidePopup();
        const editor = adapter.detectActiveEditor();
        const hostEl = (editor?.el as HTMLElement | null) || null;
        const position = hostEl ? computePopupPosition(hostEl) : { left: 12, top: 12 };
        const highlightIndex = clamp(session.highlightIndex || 0, 0, Math.max(0, items.length - 1));
        const uiItems = items.map((c: any) => ({
          title: String(c?.title || ''),
          source: String(c?.source || ''),
          domain: String(c?.domain || ''),
        }));
        inpageItemMentionApi.render({
          open: true,
          items: uiItems,
          highlightIndex,
          position,
          onPick: (index) => {
            session = session ? { ...session, highlightIndex: clamp(index, 0, Math.max(0, items.length - 1)) } : session;
            void pickHighlighted();
          },
        });
      }

      async function runSearch(query: string) {
        const reqId = (requestSeq += 1);
        const queryKey = String(query || '');
        currentQueryKey = queryKey;

        try {
          const res = await searchMentionCandidates(rt, { query: queryKey, limit: 20 });
          if (stopped) return;
          if (reqId !== requestSeq) return;
          if (!session || !session.open) return;
          if (session.query !== queryKey) return;

          items = Array.isArray((res as any).candidates) ? (res as any).candidates : [];
          if (session.highlightIndex >= items.length) {
            session = { ...session, highlightIndex: 0 };
          }
          renderPopup();
        } catch (error) {
          if (rt.isInvalidContextError?.(error)) {
            stop();
            return;
          }
          items = [];
          renderPopup();
        }
      }

      function scheduleSearch() {
        stopTimers();
        if (!session || !session.open) return;
        searchTimer = setTimeout(() => {
          searchTimer = null;
          void runSearch(session?.query || '');
        }, 120);
      }

      async function pickHighlighted() {
        if (!session || !session.open) return;
        const editor = adapter.detectActiveEditor();
        if (!editor) return;
        if (!items.length) return;
        const index = clamp(session.highlightIndex || 0, 0, items.length - 1);
        const picked = items[index];
        const conversationId = Number(picked?.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return;

        try {
          const payload = await buildMentionInsertText(rt, { conversationId });
          const markdown = String(payload?.markdown || '');
          if (!markdown) return;

          const range = { start: session.triggerStart, end: session.triggerEnd };
          adapter.replaceRange(editor, range, markdown);
          adapter.focus(editor);

          session = null;
          items = [];
          hidePopup();
        } catch (error) {
          if (rt.isInvalidContextError?.(error)) stop();
        }
      }

      function eventEditorHandle(e: Event): EditorHandle | null {
        const target = (e as any)?.target as any;
        if (!target) return null;
        const active = adapter.detectActiveEditor();
        if (!active || !active.el) return null;
        const el = active.el as any;
        if (target === el) return active;
        if (el && typeof el.contains === 'function' && el.contains(target)) return active;
        return null;
      }

      function refresh(input?: { close?: boolean }) {
        const editor = adapter.detectActiveEditor();
        if (!editor || !editor.el) {
          session = null;
          items = [];
          hidePopup();
          return;
        }

        const text =
          editor.kind === 'textarea'
            ? String((editor.el as any).value || '')
            : String((editor.el as any).textContent || '');
        const cursor =
          editor.kind === 'textarea'
            ? Number((editor.el as any).selectionStart)
            : Number(adapter.getSelectionRange(editor).end);
        lastText = text;
        lastCursor = Number.isFinite(cursor) ? cursor : text.length;

        const prevQuery = session?.query || '';
        session = updateMentionSession(session, { text, cursor: lastCursor, close: !!input?.close });
        if (!session) {
          items = [];
          hidePopup();
          return;
        }

        if (!session.open) {
          hidePopup();
          return;
        }

        if (session.query !== prevQuery) {
          items = [];
          session = { ...session, highlightIndex: 0 };
          scheduleSearch();
        } else if (!items.length) {
          scheduleSearch();
        }

        renderPopup();
      }

      function onInput(e: Event) {
        if (stopped) return;
        if (!eventEditorHandle(e)) return;
        refresh();
      }

      function onKeyDown(e: KeyboardEvent) {
        if (stopped) return;
        if (!eventEditorHandle(e)) return;

        if (!session || !session.open) return;

        if (composing && e.key !== 'Escape') return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const next = moveMentionHighlightIndex({
            current: session.highlightIndex,
            count: items.length,
            key: e.key,
          });
          session = { ...session, highlightIndex: next };
          renderPopup();
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          refresh({ close: true });
          return;
        }

        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void pickHighlighted();
          return;
        }
      }

      function onKeyUp(e: KeyboardEvent) {
        if (stopped) return;
        if (!eventEditorHandle(e)) return;
        // Cursor navigation should update trigger boundaries and potentially open/close the popup.
        refresh();
      }

      function onCompositionStart(e: CompositionEvent) {
        if (stopped) return;
        if (!eventEditorHandle(e as any)) return;
        composing = true;
      }

      function onCompositionEnd(e: CompositionEvent) {
        if (stopped) return;
        if (!eventEditorHandle(e as any)) return;
        composing = false;
        refresh();
      }

      function onFocusOut(e: FocusEvent) {
        if (stopped) return;
        const editor = eventEditorHandle(e as any);
        if (!editor) return;
        const related = (e as any).relatedTarget as any;
        // If focus stays within the editor host, ignore.
        if (related && editor.el && typeof (editor.el as any).contains === 'function' && (editor.el as any).contains(related))
          return;
        refresh({ close: true });
      }

      function stop() {
        if (stopped) return;
        stopped = true;
        stopTimers();
        try {
          unsubscribeInvalidated?.();
        } catch (_e) {
          // ignore
        }
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
        document.removeEventListener('compositionstart', onCompositionStart, true);
        document.removeEventListener('compositionend', onCompositionEnd, true);
        document.removeEventListener('focusout', onFocusOut, true);
        inpageItemMentionApi.cleanup();
      }

      document.addEventListener('input', onInput, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('compositionend', onCompositionEnd, true);
      document.addEventListener('focusout', onFocusOut, true);

      // Initial refresh to show recent items if the user already has `$` in the composer.
      try {
        refresh();
      } catch (_e) {
        // ignore
      }

      return { stop };
    },
  };
}
