import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { ChevronRight, Palette, Pause, Play, Square, Type, Volume2 } from 'lucide-react';

import { t } from '@i18n';
import {
  buttonFilledClassName,
  buttonMenuItemClassName,
  buttonTintClassName,
  menuChevronClassName,
  menuPopoverPanelClassName,
} from '@ui/shared/button-styles';
import { tooltipAttrsWithShortcut } from '@ui/shared/AppTooltip';
import { NarrationPanel } from '@ui/reader/NarrationPanel';
import { TextLayoutPanel } from '@ui/reader/TextLayoutPanel';
import { ThemePanel } from '@ui/reader/ThemePanel';
import type { ConversationKindDefinition } from '@services/protocols/conversation-kind-contract';
import type { ReaderPrefs, ReaderPrefsPatch } from '@services/protocols/reader-prefs';
import type { AppThemeMode } from '@services/protocols/app-theme';
import type { UseReaderNarrationResult } from '@viewmodels/reader/useReaderNarration';

type ReaderHeaderNarration = Pick<
  UseReaderNarrationResult,
  'state' | 'isPlaying' | 'error' | 'webSpeechAvailable' | 'stop' | 'toggle'
>;

type ReaderHeaderToolbarProps = {
  features: ConversationKindDefinition['view']['readerFeatures'];
  prefs: ReaderPrefs;
  update: (patch: ReaderPrefsPatch) => void | Promise<void>;
  preview: (patch: ReaderPrefsPatch) => void;
  commitPreview: () => Promise<void>;
  themeMode: AppThemeMode;
  updateThemeMode: (mode: AppThemeMode) => void | Promise<void>;
  narration: ReaderHeaderNarration;
  narrationShortcut?: string;
  submenuRef?: RefObject<HTMLDivElement | null>;
  className?: string;
};

type OpenPanel = 'text' | 'theme' | 'narration' | null;

const SUBMENU_CLOSE_DELAY_MS = 180;
const readerTriggerClassName = () =>
  [buttonMenuItemClassName(), 'tw-w-full tw-items-center tw-justify-between tw-text-[13px]'].join(' ');
const headerNarrationTransportButtonClassName = (active: boolean) =>
  [active ? buttonFilledClassName() : buttonTintClassName(), 'webclipper-btn--icon'].join(' ');

export function ReaderHeaderToolbar({
  features,
  prefs,
  update,
  preview,
  commitPreview,
  themeMode,
  updateThemeMode,
  narration,
  narrationShortcut,
  submenuRef,
  className,
}: ReaderHeaderToolbarProps) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const ownSubmenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = submenuRef ?? ownSubmenuRef;
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const activeRef = useRef<OpenPanel>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnOpenRef = useRef(false);
  const labels = {
    toolbarAria: t('readerToolbarAria'),
    text: t('readerTextLayoutButton'),
    theme: t('readerThemeButton'),
    narration: t('readerNarrationButton'),
    play: t('readerNarrationPlay'),
    reading: t('readerNarrationReading'),
    pause: t('readerNarrationPause'),
    stop: t('readerNarrationStop'),
  } as const;

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const transitionPanel = (next: OpenPanel) => {
    const previous = activeRef.current;
    if (previous === next) return;
    if (previous === 'text' || previous === 'narration') void commitPreview().catch(() => {});
    activeRef.current = next;
    setOpenPanel(next);
    setPosition(null);
  };
  const openSubmenu = (panel: Exclude<OpenPanel, null>, trigger: HTMLButtonElement, focus = false) => {
    clearCloseTimer();
    anchorRef.current = trigger;
    focusOnOpenRef.current = focus;
    if (activeRef.current === panel) {
      if (focus) panelRef.current?.querySelector<HTMLElement>('button, input, select, [tabindex]')?.focus();
      return;
    }
    transitionPanel(panel);
  };
  const closeSubmenu = (restoreFocus: boolean) => {
    clearCloseTimer();
    const anchor = anchorRef.current;
    transitionPanel(null);
    if (restoreFocus) anchor?.focus();
  };
  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      transitionPanel(null);
    }, SUBMENU_CLOSE_DELAY_MS);
  };

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const floating = panelRef.current;
    if (!openPanel || !anchor || !floating) return;
    let disposed = false;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const requiredWidth = floating.getBoundingClientRect().width + 18;
      const sideFits = rect.left >= requiredWidth || viewportWidth - rect.right >= requiredWidth;
      void computePosition(anchor, floating, {
        strategy: 'fixed',
        placement: sideFits ? 'left-start' : 'bottom-end',
        middleware: [
          offset(sideFits ? 6 : 2),
          flip({
            fallbackPlacements: sideFits ? ['right-start'] : ['top-end'],
            crossAxis: sideFits,
            padding: 12,
          }),
          shift({ padding: 12, crossAxis: sideFits }),
          size({
            padding: 12,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (!disposed) setPosition({ x: Math.round(x), y: Math.round(y) });
      });
    };
    const stop = autoUpdate(anchor, floating, updatePosition);
    return () => {
      disposed = true;
      stop();
    };
  }, [openPanel, panelRef]);

  useLayoutEffect(() => {
    if (!openPanel || !position || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    panelRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')
      ?.focus({ preventScroll: true });
  }, [openPanel, position, panelRef]);

  useEffect(() => {
    if (!openPanel) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [openPanel, panelRef]);

  useEffect(
    () => () => {
      clearTimeout(closeTimerRef.current ?? undefined);
      if (activeRef.current === 'text' || activeRef.current === 'narration') void commitPreview().catch(() => {});
    },
    [commitPreview],
  );

  if (!features.textLayout && !features.theme && !features.narration) return null;

  const narrationActionLabel =
    narration.state === 'loading' ? labels.reading : narration.isPlaying ? labels.pause : labels.play;
  const NarrationActionIcon = narration.state === 'loading' || narration.isPlaying ? Pause : Play;
  const items = [
    features.textLayout ? { id: 'text' as const, label: labels.text, Icon: Type } : null,
    features.theme ? { id: 'theme' as const, label: labels.theme, Icon: Palette } : null,
    features.narration ? { id: 'narration' as const, label: labels.narration, Icon: Volume2 } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  const currentLabel = items.find((item) => item.id === openPanel)?.label || '';

  const onItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, panel: Exclude<OpenPanel, null>) => {
    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSubmenu(panel, event.currentTarget, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const menu = event.currentTarget.closest('[role="menu"]');
      const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
      const current = buttons.indexOf(event.currentTarget);
      const next = buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
    }
  };

  return (
    <div
      role="group"
      aria-label={labels.toolbarAria}
      className={['tw-flex tw-flex-col tw-gap-1', className || ''].join(' ').trim()}
      data-reader-header-toolbar="true"
      onPointerEnter={clearCloseTimer}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && event.buttons === 0) scheduleClose();
      }}
    >
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          aria-haspopup="dialog"
          aria-expanded={openPanel === id}
          data-reader-header-trigger={id}
          aria-label={label}
          className={readerTriggerClassName()}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && event.buttons === 0) openSubmenu(id, event.currentTarget);
          }}
          onClick={(event) => {
            if (activeRef.current === id) closeSubmenu(true);
            else openSubmenu(id, event.currentTarget, event.detail === 0);
          }}
          onKeyDown={(event) => onItemKeyDown(event, id)}
        >
          <span className="tw-inline-flex tw-items-center tw-gap-2">
            <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>{label}</span>
          </span>
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={menuChevronClassName()} />
        </button>
      ))}
      {openPanel &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={currentLabel}
            data-reader-submenu={openPanel}
            className={[
              menuPopoverPanelClassName(170),
              'tw-fixed tw-z-[110] tw-w-[320px] tw-max-w-[calc(100vw-24px)]',
              'tw-overflow-y-auto tw-overscroll-contain tw-bg-[var(--bg-card)] tw-p-3 tw-text-[var(--text-primary)]',
            ].join(' ')}
            style={{ left: position?.x ?? 0, top: position?.y ?? 0, visibility: position ? 'visible' : 'hidden' }}
            onPointerEnter={clearCloseTimer}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse' && event.buttons === 0) scheduleClose();
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeSubmenu(true);
              } else if (
                event.key === 'ArrowLeft' &&
                !(event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
              ) {
                event.preventDefault();
                event.stopPropagation();
                closeSubmenu(true);
              }
            }}
          >
            {openPanel === 'text' ? (
              <TextLayoutPanel prefs={prefs} update={update} preview={preview} commitPreview={commitPreview} />
            ) : null}
            {openPanel === 'theme' ? <ThemePanel mode={themeMode} update={updateThemeMode} /> : null}
            {openPanel === 'narration' ? (
              <div className="tw-flex tw-flex-col tw-gap-3">
                <div className="tw-flex tw-gap-1.5">
                  <button
                    type="button"
                    className={headerNarrationTransportButtonClassName(true)}
                    aria-label={narrationActionLabel}
                    data-reader-narration-play-pause="true"
                    {...tooltipAttrsWithShortcut(narrationActionLabel, narrationShortcut, 'bottom')}
                    aria-pressed={narration.isPlaying || narration.state === 'loading'}
                    onClick={() => narration.toggle()}
                  >
                    <NarrationActionIcon size={18} strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    className={headerNarrationTransportButtonClassName(false)}
                    aria-label={labels.stop}
                    title={labels.stop}
                    onClick={narration.stop}
                    disabled={narration.state === 'idle'}
                  >
                    <Square size={18} strokeWidth={2.25} />
                  </button>
                </div>
                <NarrationPanel
                  prefs={prefs}
                  update={update}
                  preview={preview}
                  commitPreview={commitPreview}
                  error={narration.error}
                  webSpeechAvailable={narration.webSpeechAvailable}
                />
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
