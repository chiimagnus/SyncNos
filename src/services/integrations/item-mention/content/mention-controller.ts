import { buildMentionInsertText, searchMentionCandidates } from '@services/integrations/item-mention/client';
import type { EditorAdapter, EditorHandle } from '@services/integrations/item-mention/content/editor-adapter';
import { chatgptComposerEditorAdapter } from '@services/integrations/item-mention/content/editor-chatgpt';
import { geminiContentEditableAdapter } from '@services/integrations/item-mention/content/editor-gemini';
import { notionAiContentEditableAdapter } from '@services/integrations/item-mention/content/editor-notionai';
import { textareaOrContentEditableEditorAdapter } from '@services/integrations/item-mention/content/editor-textarea-or-contenteditable';
import { pickMentionSupportedSiteIdByHostname } from '@services/integrations/item-mention/content/mention-sites';
import type { MentionSessionState } from '@services/integrations/item-mention/content/mention-session';
import { updateMentionSession } from '@services/integrations/item-mention/content/mention-session';
import { moveMentionHighlightIndex } from '@services/integrations/item-mention/content/mention-ui-state';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
  onInvalidated?: (listener: (error: Error) => void) => () => void;
  isInvalidContextError?: (error: unknown) => boolean;
};

type ItemMentionUiItem = {
  title: string;
  source: string;
  domain: string;
};

// Controller stays in `services/**` and must not import UI. UI is injected from entrypoints.
type ItemMentionUiApi = {
  render: (input: {
    open: boolean;
    items: ItemMentionUiItem[];
    highlightIndex: number;
    position?: { left: number; top: number } | null;
    onPick?: ((index: number) => void) | null;
  }) => void;
  cleanup?: () => void;
};

const noopItemMentionUi: ItemMentionUiApi = {
  render() {},
  cleanup() {},
};

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

export function createItemMentionController(deps: { runtime: RuntimeClient | null; ui?: ItemMentionUiApi | null }) {
  const runtime = deps.runtime;
  const ui = deps.ui || noopItemMentionUi;

  return {
    start() {
      if (!runtime || typeof runtime.send !== 'function') return null;
      const rt: RuntimeClient = runtime;
      const hostname = location?.hostname || '';
      const siteId = pickMentionSupportedSiteIdByHostname(hostname);
      if (!siteId) return null;

      const adapterMaybe = (() => {
        if (siteId === 'chatgpt') return chatgptComposerEditorAdapter;
        if (siteId === 'notionai') return notionAiContentEditableAdapter;
        if (siteId === 'gemini') return geminiContentEditableAdapter;
        return textareaOrContentEditableEditorAdapter;
      })();
      if (!adapterMaybe) return null;
      const adapter: EditorAdapter = adapterMaybe;

      let stopped = false;
      let session: MentionSessionState | null = null;
      let items: any[] = [];
      let lastCursor = 0;
      let searchTimer: ReturnType<typeof setTimeout> | null = null;
      let requestSeq = 0;
      let pickSeq = 0;
      let pickInFlight = false;
      let composing = false;
      let activationGeneration = 0;
      let activationReady = false;
      let revisionUnsubscribe: (() => void) | null = null;
      let pendingSearch = false;
      let activeSearch: { activationGeneration: number; requestId: number; query: string } | null = null;
      const unsubscribeInvalidated = rt.onInvalidated?.(() => stop()) || null;

      function stopTimers() {
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = null;
        }
      }

      function hidePopup() {
        ui.render({ open: false, items: [], highlightIndex: 0, position: null, onPick: null });
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
        ui.render({
          open: true,
          items: uiItems,
          highlightIndex,
          position,
          onPick: (index) => {
            session = session
              ? { ...session, highlightIndex: clamp(index, 0, Math.max(0, items.length - 1)) }
              : session;
            void pickHighlighted();
          },
        });
      }

      function deactivateMentionActivation() {
        if (!revisionUnsubscribe && !activationReady && !pendingSearch && !activeSearch) return;
        activationGeneration += 1;
        activationReady = false;
        requestSeq += 1;
        pendingSearch = false;
        activeSearch = null;
        stopTimers();
        try {
          revisionUnsubscribe?.();
        } catch (_error) {
          // ignore observer cleanup errors
        }
        revisionUnsubscribe = null;
      }

      function schedulePendingSearch() {
        if (stopped || !session?.open || !activationReady || !pendingSearch || activeSearch) return;
        stopTimers();
        searchTimer = setTimeout(() => {
          searchTimer = null;
          if (stopped || !session?.open || !activationReady || activeSearch || !pendingSearch) return;
          pendingSearch = false;
          void runSearch(session.query);
        }, 120);
      }

      function queueLatestSearch() {
        if (stopped || !session?.open) return;
        requestSeq += 1;
        pendingSearch = true;
        schedulePendingSearch();
      }

      function activateMentionSession() {
        if (stopped || !session?.open || revisionUnsubscribe) return;
        const generation = ++activationGeneration;
        activationReady = false;
        revisionUnsubscribe = subscribeDataRevisionChanges((scopes) => {
          if (stopped || generation !== activationGeneration || !session?.open) return;
          if (!scopes.includes('conversations')) return;
          queueLatestSearch();
        });
        void whenDataRevisionObserverReady().then(() => {
          if (stopped || generation !== activationGeneration || !session?.open) return;
          activationReady = true;
          schedulePendingSearch();
        });
      }

      async function runSearch(query: string) {
        if (stopped || !session?.open || !activationReady || activeSearch) return;
        const queryKey = String(query || '');
        const requestId = ++requestSeq;
        const search = { activationGeneration, requestId, query: queryKey };
        activeSearch = search;

        const isCurrentSearch = () =>
          !stopped &&
          activeSearch === search &&
          search.activationGeneration === activationGeneration &&
          search.requestId === requestSeq &&
          !!session?.open &&
          session.query === queryKey;

        try {
          const res = await searchMentionCandidates(rt, { query: queryKey, limit: 20 });
          if (!isCurrentSearch()) return;

          items = Array.isArray((res as any).candidates) ? (res as any).candidates : [];
          if (session!.highlightIndex >= items.length) {
            session = { ...session!, highlightIndex: 0 };
          }
          renderPopup();
        } catch (error) {
          if (!isCurrentSearch()) return;
          if (rt.isInvalidContextError?.(error)) {
            stop();
            return;
          }
          requestDataRevisionRetry(['conversations']);
          renderPopup();
        } finally {
          if (activeSearch === search) activeSearch = null;
          schedulePendingSearch();
        }
      }

      async function pickHighlighted() {
        if (!session || !session.open) return;
        const editor = adapter.detectActiveEditor();
        if (!editor) return;
        if (!items.length) return;

        const pickId = (pickSeq += 1);
        const sessionSnapshot = {
          query: session.query,
          triggerStart: session.triggerStart,
          triggerEnd: session.triggerEnd,
        };
        const editorElSnapshot = editor.el;

        const index = clamp(session.highlightIndex || 0, 0, items.length - 1);
        const picked = items[index];
        const conversationId = Number(picked?.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return;

        pickInFlight = true;
        deactivateMentionActivation();

        try {
          const payload = await buildMentionInsertText(rt, { conversationId });
          if (stopped) return;
          if (pickId !== pickSeq) return;
          if (!session || !session.open) return;
          if (
            session.query !== sessionSnapshot.query ||
            session.triggerStart !== sessionSnapshot.triggerStart ||
            session.triggerEnd !== sessionSnapshot.triggerEnd
          ) {
            return;
          }
          const currentEditor = adapter.detectActiveEditor();
          if (!currentEditor || currentEditor.el !== editorElSnapshot) return;

          const markdown = String(payload?.markdown || '');
          if (!markdown) return;

          const range = { start: sessionSnapshot.triggerStart, end: sessionSnapshot.triggerEnd };
          adapter.replaceRange(currentEditor, range, markdown);
          adapter.focus(currentEditor);

          pickInFlight = false;
          deactivateMentionActivation();
          session = null;
          items = [];
          hidePopup();
        } catch (error) {
          if (rt.isInvalidContextError?.(error)) {
            stop();
            return;
          }
          if (
            !stopped &&
            pickId === pickSeq &&
            session?.open &&
            session.query === sessionSnapshot.query &&
            session.triggerStart === sessionSnapshot.triggerStart &&
            session.triggerEnd === sessionSnapshot.triggerEnd
          ) {
            pickInFlight = false;
            activateMentionSession();
          }
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
        const wasOpen = session?.open === true;
        if (!editor || !editor.el) {
          if (wasOpen) pickSeq += 1;
          session = null;
          items = [];
          deactivateMentionActivation();
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
        lastCursor = Number.isFinite(cursor) ? cursor : text.length;

        const prevQuery = session?.query || '';
        const prevTriggerStart = session?.triggerStart ?? -1;
        const prevTriggerEnd = session?.triggerEnd ?? -1;
        session = updateMentionSession(session, { text, cursor: lastCursor, close: !!input?.close });
        if (!session) {
          if (wasOpen) pickSeq += 1;
          pickInFlight = false;
          items = [];
          deactivateMentionActivation();
          hidePopup();
          return;
        }

        if (!session.open) {
          if (wasOpen) pickSeq += 1;
          pickInFlight = false;
          deactivateMentionActivation();
          hidePopup();
          return;
        }

        const queryChanged = session.query !== prevQuery;
        const pickContextChanged =
          queryChanged || session.triggerStart !== prevTriggerStart || session.triggerEnd !== prevTriggerEnd;
        if (pickContextChanged) {
          pickSeq += 1;
          pickInFlight = false;
        }

        if (!pickInFlight) activateMentionSession();
        if (queryChanged) {
          items = [];
          session = { ...session, highlightIndex: 0 };
          queueLatestSearch();
        } else if (!pickInFlight && !items.length && !activeSearch && !pendingSearch) {
          queueLatestSearch();
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
        if (
          related &&
          editor.el &&
          typeof (editor.el as any).contains === 'function' &&
          (editor.el as any).contains(related)
        )
          return;
        refresh({ close: true });
      }

      function stop() {
        if (stopped) return;
        stopped = true;
        pickSeq += 1;
        pickInFlight = false;
        deactivateMentionActivation();
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
        ui.cleanup?.();
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
