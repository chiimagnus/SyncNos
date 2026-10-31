import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import type { ChatOutlineEntry } from '@ui/conversations/chat-outline/outline-entries';
import { readerOutlineLevelToMinimapWidth } from '@services/protocols/reader-outline';
import {
  OUTLINE_STRIP_BAR_LEVEL_1,
  OUTLINE_STRIP_BAR_LEVEL_2,
  OUTLINE_STRIP_BUTTON_CLASS,
  OUTLINE_STRIP_CLASS,
  outlineStripBarClassName,
} from '@ui/reader/outline-strip-bars';
import { ReaderRailPanel } from '@ui/reader/ReaderRailPanel';
import { buttonMenuItemClassName } from '@ui/shared/button-styles';

export type ChatOutlinePanelProps = {
  entries: ChatOutlineEntry[];
  activeIndex?: number | null;
  onPickEntry: (entry: ChatOutlineEntry) => void;
};

const OUTLINE_LABEL = 'Outline';
const PANEL_LIST_CLASS = 'tw-flex tw-max-h-[60vh] tw-flex-col tw-gap-1 tw-overflow-auto';
const TRIGGER_ACTIVE_BAR_WIDTH = readerOutlineLevelToMinimapWidth(OUTLINE_STRIP_BAR_LEVEL_1);
const TRIGGER_INACTIVE_BAR_WIDTH = readerOutlineLevelToMinimapWidth(OUTLINE_STRIP_BAR_LEVEL_2);
const PANEL_ENTRY_LABEL_CLASS = 'tw-min-w-0 tw-flex-1 tw-text-left';
const PANEL_ENTRY_LABEL_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  lineHeight: 1.35,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

function toItemClass(active: boolean): string {
  return [
    buttonMenuItemClassName(),
    'tw-shrink-0 tw-items-start tw-text-xs',
    active ? '' : 'webclipper-btn--tone-muted',
  ]
    .filter(Boolean)
    .join(' ');
}

function toLabel(entry: ChatOutlineEntry): string {
  const text = String(entry.previewText || '').trim();
  return text ? `${entry.index}. ${text}` : `${entry.index}.`;
}

export function ChatOutlinePanel({ entries, activeIndex = null, onPickEntry }: ChatOutlinePanelProps) {
  const stripRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip || strip.scrollHeight <= strip.clientHeight) return;
    const activeBar = strip.querySelector('[data-chat-outline-trigger-active="true"]');
    const activeButton = activeBar?.parentElement;
    if (!activeButton) return;
    const stripRect = strip.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    if (buttonRect.top < stripRect.top) strip.scrollTop += buttonRect.top - stripRect.top;
    else if (buttonRect.bottom > stripRect.bottom) strip.scrollTop += buttonRect.bottom - stripRect.bottom;
  }, [activeIndex, entries]);

  if (!entries.length) return null;

  const trigger = (
    <nav
      ref={stripRef}
      className={`${OUTLINE_STRIP_CLASS} tw-max-h-[calc(100vh-10rem)] tw-justify-between tw-overflow-y-auto`}
      style={{ height: `${entries.length * 10}px`, rowGap: 0 }}
      aria-label={OUTLINE_LABEL}
      data-chat-outline-trigger-bars={entries.length}
    >
      {entries.map((entry) => {
        const isActive = activeIndex === entry.index;
        const label = toLabel(entry);
        return (
          <button
            key={entry.messageKey}
            type="button"
            aria-label={label}
            title={label}
            className={OUTLINE_STRIP_BUTTON_CLASS}
            onClick={() => onPickEntry(entry)}
          >
            <span
              className={outlineStripBarClassName(isActive)}
              style={{ width: `${isActive ? TRIGGER_ACTIVE_BAR_WIDTH : TRIGGER_INACTIVE_BAR_WIDTH}px` }}
              data-chat-outline-trigger-bar={entry.messageKey}
              data-chat-outline-trigger-active={isActive ? 'true' : 'false'}
            />
          </button>
        );
      })}
    </nav>
  );

  return (
    <ReaderRailPanel
      id="chat-outline"
      label={OUTLINE_LABEL}
      narrow={false}
      className="tw-absolute tw-right-0 tw-top-2"
      trigger={trigger}
    >
      <div className={PANEL_LIST_CLASS}>
        {entries.map((entry) => {
          const isActive = activeIndex === entry.index;
          const label = toLabel(entry);
          return (
            <button
              key={entry.messageKey}
              type="button"
              className={toItemClass(isActive)}
              title={label}
              aria-checked={isActive ? 'true' : undefined}
              onClick={() => onPickEntry(entry)}
              data-chat-outline-entry={entry.messageKey}
              data-chat-outline-active={isActive ? 'true' : 'false'}
            >
              <span
                className={PANEL_ENTRY_LABEL_CLASS}
                style={PANEL_ENTRY_LABEL_STYLE}
                data-chat-outline-entry-label={entry.messageKey}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </ReaderRailPanel>
  );
}
