import { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';

import { t } from '@i18n';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { DetailHeaderActionBar } from '@ui/conversations/DetailHeaderActionBar';
import { navIconButtonClassName } from '@ui/shared/nav-styles';
import { buttonTintClassName } from '@ui/shared/button-styles';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';

export type DetailNavigationHeaderProps = {
  title: string;
  subtitle?: string;
  actions: DetailHeaderAction[];
  onBack: () => void;
};

const backButtonClass = navIconButtonClassName(false);
const headerActionButtonClass = buttonTintClassName();

export function DetailNavigationHeader({ title, subtitle, actions, onBack }: DetailNavigationHeaderProps) {
  const { activeId, updateSelectedConversationUrl, cleanUrlDraft } = useConversationsApp();
  const safeActions = Array.isArray(actions) ? actions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const chatWithActions = safeActions.filter((action) => action.slot === 'chat-with');
  const toolActions = safeActions.filter((action) => action.slot === 'tools');

  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlCleaning, setUrlCleaning] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const displayedUrl = String(subtitle || '').trim();
  const showSubtitleRow = subtitle != null;

  useEffect(() => {
    setUrlEditing(false);
    setUrlDraft('');
    setUrlCleaning(false);
  }, [activeId]);

  useEffect(() => {
    if (!urlEditing) return;
    const timer = setTimeout(() => {
      try {
        urlInputRef.current?.focus?.();
      } catch (_e) {
        // ignore
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [urlEditing]);

  const saveUrlDraft = async () => {
    await updateSelectedConversationUrl(String(urlDraft || ''));
    setUrlEditing(false);
  };

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 md:tw-grid md:tw-gap-2">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
        <button type="button" onClick={onBack} className={backButtonClass} aria-label={t('backToChatsAria')}>
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-truncate tw-text-[13px] tw-font-black tw-tracking-[-0.01em] tw-text-[var(--text-primary)]">
            {title}
          </div>
          {showSubtitleRow ? (
            <div className="tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
              {urlEditing ? (
                <span className="tw-inline-flex tw-min-w-0 tw-items-center tw-gap-2">
                  <input
                    ref={urlInputRef}
                    className="tw-min-w-0 tw-flex-1 tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    placeholder="https://"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setUrlEditing(false);
                        setUrlDraft('');
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        void (async () => {
                          try {
                            await saveUrlDraft();
                          } catch (error) {
                            const message =
                              error instanceof Error && error.message
                                ? error.message
                                : String(error || t('actionFailedFallback'));
                            if (message === 'SYNCNOS_URL_EDIT_CANCELLED') return;
                            if (typeof globalThis.window?.alert === 'function') globalThis.window.alert(message);
                            else console.error(message);
                          }
                        })();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="tw-shrink-0 tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-extrabold tw-text-[var(--text-secondary)] hover:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_85%,var(--bg-card))] disabled:tw-opacity-60"
                    disabled={urlCleaning}
                    onClick={() => {
                      if (urlCleaning) return;
                      void (async () => {
                        setUrlCleaning(true);
                        try {
                          const cleaned = await cleanUrlDraft(String(urlDraft || ''));
                          setUrlDraft(cleaned);
                        } catch (error) {
                          const message =
                            error instanceof Error && error.message
                              ? error.message
                              : String(error || t('actionFailedFallback'));
                          if (typeof globalThis.window?.alert === 'function') globalThis.window.alert(message);
                          else console.error(message);
                        } finally {
                          setUrlCleaning(false);
                        }
                      })();
                    }}
                  >
                    {urlCleaning ? '…' : '清理'}
                  </button>
                  <span className="tw-shrink-0 tw-whitespace-nowrap tw-opacity-80">Enter · Esc</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="tw-min-w-0 tw-truncate tw-text-left tw-underline-offset-2 hover:tw-underline focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
                  onClick={() => {
                    setUrlDraft(displayedUrl);
                    setUrlEditing(true);
                  }}
                  aria-label={displayedUrl ? 'Edit URL' : 'Set URL'}
                  title={displayedUrl || t('noLinkAvailable')}
                >
                  {displayedUrl || t('noLinkAvailable')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
        <DetailHeaderActionBar
          actions={toolActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderToolsMenuLabel')}
          menuTriggerTitle={t('detailHeaderToolsMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderToolsMenuAria')}
          menuAriaLabel={t('detailHeaderToolsMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
        <DetailHeaderActionBar
          actions={chatWithActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderChatWithMenuLabel')}
          menuTriggerTitle={t('detailHeaderChatWithMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderChatWithMenuAria')}
          menuAriaLabel={t('detailHeaderChatWithMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
        <DetailHeaderActionBar
          actions={openActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderOpenInMenuLabel')}
          menuTriggerTitle={t('detailHeaderOpenInMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderOpenInMenuAria')}
          menuAriaLabel={t('detailHeaderOpenInMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
      </div>
    </div>
  );
}
