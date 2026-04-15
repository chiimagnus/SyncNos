import { useEffect, useMemo, useRef, useState } from 'react';

import {
  computeOutlineCenterY,
  pickActiveOutlineIndex,
  type OutlineIndexCandidate,
  type OutlineRectLike,
} from '@ui/conversations/chat-outline/active-index';

const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];
const FALLBACK_NEAREST_WINDOW = 24;

export type UseChatOutlineActiveIndexInput = {
  root: Element | null;
  userMessageEls: HTMLElement[];
  messagesRootEl?: HTMLElement | null;
};

function readViewportRect(): OutlineRectLike {
  const docEl = globalThis.document?.documentElement;
  if (!docEl) return { top: 0, bottom: 0 };
  const rect = docEl.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function toOutlineIndex(el: HTMLElement, fallback: number): number {
  const raw = Number(el.dataset.chatOutlineIndex);
  if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  return fallback;
}

function toCandidate(el: HTMLElement, fallbackIndex: number): OutlineIndexCandidate {
  const rect = el.getBoundingClientRect();
  return {
    index: toOutlineIndex(el, fallbackIndex),
    top: rect.top,
    bottom: rect.bottom,
  };
}

export function useChatOutlineActiveIndex({
  root,
  userMessageEls,
  messagesRootEl = null,
}: UseChatOutlineActiveIndexInput): number | null {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const visibleSetRef = useRef<Set<HTMLElement>>(new Set());
  const rafRef = useRef<number | null>(null);
  const safeUserMessageEls = useMemo(
    () => (Array.isArray(userMessageEls) ? userMessageEls.filter(Boolean) : []),
    [userMessageEls],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    const win = globalThis.window;
    visibleSetRef.current.clear();

    if (rafRef.current != null) {
      win?.cancelAnimationFrame?.(rafRef.current);
      rafRef.current = null;
    }

    if (!safeUserMessageEls.length) {
      activeIndexRef.current = null;
      setActiveIndex(null);
      return;
    }

    const rootEl = root && root instanceof Element ? root : null;
    const supportsIntersectionObserver = typeof globalThis.IntersectionObserver === 'function';
    const fallbackIndexByEl = new Map<HTMLElement, number>();
    safeUserMessageEls.forEach((el, idx) => {
      fallbackIndexByEl.set(el, idx + 1);
    });

    const recompute = () => {
      const viewportRect = readViewportRect();
      const rootRect = rootEl ? rootEl.getBoundingClientRect() : null;
      const messagesRect = messagesRootEl ? messagesRootEl.getBoundingClientRect() : null;
      const centerY = computeOutlineCenterY({ rootRect, viewportRect, messagesRect });
      const visibleCandidates: OutlineIndexCandidate[] = [];
      if (supportsIntersectionObserver) {
        for (const el of visibleSetRef.current) {
          const fallbackIndex = fallbackIndexByEl.get(el);
          if (!fallbackIndex) continue;
          visibleCandidates.push(toCandidate(el, fallbackIndex));
        }
      } else {
        const previous = Number(activeIndexRef.current);
        const previousIndex = Number.isFinite(previous) && previous > 0 ? Math.trunc(previous) - 1 : 0;
        const start = Math.max(0, previousIndex - FALLBACK_NEAREST_WINDOW);
        const end = Math.min(safeUserMessageEls.length, previousIndex + FALLBACK_NEAREST_WINDOW + 1);
        for (let idx = start; idx < end; idx += 1) {
          visibleCandidates.push(toCandidate(safeUserMessageEls[idx], idx + 1));
        }
      }
      const previousActiveIndex = activeIndexRef.current;
      const canReusePrevious = Number.isFinite(previousActiveIndex) && Number(previousActiveIndex) > 0;
      const shouldBuildAllCandidates =
        !canReusePrevious && (!supportsIntersectionObserver || visibleCandidates.length === 0);
      const allCandidates = shouldBuildAllCandidates
        ? safeUserMessageEls.map((el, idx) => toCandidate(el, idx + 1))
        : undefined;
      const nextActiveIndex = pickActiveOutlineIndex({
        centerY,
        visibleCandidates,
        allCandidates,
        previousActiveIndex,
      });
      if (nextActiveIndex === activeIndexRef.current) return;
      activeIndexRef.current = nextActiveIndex;
      setActiveIndex(nextActiveIndex);
    };

    const scheduleRecompute = () => {
      if (!win || typeof win.requestAnimationFrame !== 'function') {
        recompute();
        return;
      }
      if (rafRef.current != null) return;
      rafRef.current = win.requestAnimationFrame(() => {
        rafRef.current = null;
        recompute();
      });
    };

    let observer: IntersectionObserver | null = null;
    if (supportsIntersectionObserver) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            if (entry.intersectionRatio > 0) visibleSetRef.current.add(target);
            else visibleSetRef.current.delete(target);
          }
          scheduleRecompute();
        },
        {
          root: rootEl,
          threshold: OBSERVER_THRESHOLDS,
        },
      );
      for (const el of safeUserMessageEls) observer.observe(el);
    }

    const scrollTarget: EventTarget | null = rootEl || win || null;
    const onScroll = () => scheduleRecompute();
    const onResize = () => scheduleRecompute();

    scrollTarget?.addEventListener?.('scroll', onScroll, { passive: true });
    win?.addEventListener?.('resize', onResize, { passive: true });
    scheduleRecompute();

    return () => {
      observer?.disconnect();
      visibleSetRef.current.clear();
      scrollTarget?.removeEventListener?.('scroll', onScroll);
      win?.removeEventListener?.('resize', onResize);
      if (rafRef.current != null) {
        win?.cancelAnimationFrame?.(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [root, messagesRootEl, safeUserMessageEls]);

  return activeIndex;
}
