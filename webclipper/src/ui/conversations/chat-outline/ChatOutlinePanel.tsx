import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatOutlineEntry } from '@ui/conversations/chat-outline/outline-entries';

export type ChatOutlinePanelProps = {
  entries: ChatOutlineEntry[];
  activeIndex?: number | null;
  onPickEntry?: (entry: ChatOutlineEntry) => void;
};

const CLOSE_DELAY_MS = 160;

function toLabel(entry: ChatOutlineEntry): string {
  const text = String(entry.previewText || '').trim();
  return text ? `${entry.index}. ${text}` : `${entry.index}.`;
}

export function ChatOutlinePanel({ entries, activeIndex = null, onPickEntry }: ChatOutlinePanelProps) {
  const safeEntries = useMemo(() => (Array.isArray(entries) ? entries : []), [entries]);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current == null) return;
    globalThis.window?.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const openPanel = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = globalThis.window?.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  return (
    <div className="tw-absolute tw-right-0 tw-top-2 tw-z-30 tw-h-11 tw-w-9" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        aria-label="Outline"
        className={[
          'tw-absolute tw-right-0 tw-top-0 tw-grid tw-h-11 tw-w-9 tw-place-items-center tw-rounded-[12px] tw-border-0 tw-bg-transparent tw-p-0 tw-shadow-none',
          open ? 'tw-pointer-events-none tw-opacity-0' : 'tw-opacity-100',
        ].join(' ')}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        <span className="tw-grid tw-h-4 tw-w-[14px] tw-content-center tw-gap-[6px]" aria-hidden="true">
          <span className="tw-h-[2.4px] tw-rounded-[2px] tw-bg-[var(--text-secondary)] tw-opacity-80" />
          <span className="tw-h-[2.4px] tw-rounded-[2px] tw-bg-[var(--text-secondary)] tw-opacity-80" />
        </span>
      </button>

      <aside
        className={[
          'tw-absolute tw-right-0 tw-top-[-6px] tw-z-10 tw-flex tw-h-[304px] tw-w-[292px] tw-flex-col tw-overflow-hidden tw-rounded-[18px] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-shadow-[0_10px_22px_rgba(0,0,0,0.18)]',
          'tw-transition-all tw-duration-150 tw-ease-out',
          open ? 'tw-translate-x-0 tw-opacity-100 tw-pointer-events-auto' : 'tw-translate-x-3 tw-opacity-0 tw-pointer-events-none',
        ].join(' ')}
        aria-label="Outline panel"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <header className="tw-px-4 tw-pb-2.5 tw-pt-3.5">
          <p className="tw-m-0 tw-text-sm tw-font-black tw-text-[var(--text-primary)]">目录</p>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
            用户消息（前 30 字 …）
          </p>
        </header>

        <div className="tw-grid tw-min-h-0 tw-flex-1 tw-auto-rows-min tw-gap-2.5 tw-overflow-auto tw-px-3.5 tw-pb-3">
          {safeEntries.length ? (
            safeEntries.map((entry) => {
              const isActive = Number(activeIndex) === entry.index;
              return (
                <button
                  key={entry.messageKey}
                  type="button"
                  className={[
                    'tw-h-9 tw-w-full tw-truncate tw-rounded-[12px] tw-border tw-px-3 tw-text-left tw-text-xs tw-font-semibold',
                    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                    isActive
                      ? 'tw-border-[#dfe3ff] tw-bg-[#f6f7ff] tw-text-[#3b48ff]'
                      : 'tw-border-[#eee] tw-bg-[var(--bg-card)] tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-sunken)]',
                  ].join(' ')}
                  title={toLabel(entry)}
                  onClick={() => onPickEntry?.(entry)}
                >
                  {toLabel(entry)}
                </button>
              );
            })
          ) : (
            <p className="tw-m-0 tw-px-2 tw-pt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">暂无用户消息</p>
          )}
        </div>
      </aside>
    </div>
  );
}
