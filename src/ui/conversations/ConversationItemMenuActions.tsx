import { useState } from 'react';
import { t } from '@i18n';
import type { SyncProvider } from '@services/sync/models';
import { getSyncProviderDefinition } from '@services/sync/sync-provider-registry';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';
import type { InAppShortcutAction } from '@services/shortcuts/in-app-shortcuts';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { buttonMenuItemClassName } from '@ui/shared/button-styles';

type Props = {
  conversationId: number;
  originalUrl?: string;
  onClose: () => void;
  onPopupSyncPreparing?: (provider: SyncProvider, handoffIds?: readonly number[]) => void | Promise<void>;
  getShortcut?: (action: InAppShortcutAction) => string;
};

export function ConversationItemMenuActions({
  conversationId,
  originalUrl,
  onClose,
  onPopupSyncPreparing,
  getShortcut,
}: Props) {
  const {
    exporting,
    deleting,
    syncFeedback,
    enabledSyncProviders,
    exportConversationMarkdown,
    exportConversationJson,
    copyConversationSourceLink,
    syncConversation,
    deleteConversation,
  } = useConversationsApp();

  const [syncExpanded, setSyncExpanded] = useState(false);
  const busy = exporting || deleting || syncFeedback.phase === 'running';
  const menuClass = buttonMenuItemClassName();

  const run = (operation: () => Promise<void>) => {
    onClose();
    void operation().catch((error: unknown) => {
      window.alert(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <button
        type="button"
        role="menuitem"
        data-item-copy-original-link={conversationId}
        className={menuClass}
        disabled={!sanitizeHttpUrl(originalUrl)}
        onClick={() => run(() => copyConversationSourceLink(conversationId))}
      >
        {t('keyboardShortcutsCopyOriginalLink')}
        {getShortcut?.('copy-list-link') ? (
          <span className="tw-ml-auto tw-text-xs tw-text-[var(--text-secondary)]">{getShortcut('copy-list-link')}</span>
        ) : null}
      </button>
      <button
        type="button"
        role="menuitem"
        data-item-export-markdown={conversationId}
        className={menuClass}
        disabled={busy}
        onClick={() => run(() => exportConversationMarkdown(conversationId))}
      >
        {t('exportButton')} · {t('markdownExport')}
        {getShortcut?.('export-item') ? (
          <span className="tw-ml-auto tw-text-xs tw-text-[var(--text-secondary)]">{getShortcut('export-item')}</span>
        ) : null}
      </button>
      <button
        type="button"
        role="menuitem"
        data-item-export-json={conversationId}
        className={menuClass}
        disabled={busy}
        onClick={() => run(() => exportConversationJson(conversationId))}
      >
        {t('exportButton')} · {t('jsonExport')}
      </button>
      {enabledSyncProviders.length ? (
        <>
          <button
            type="button"
            role="menuitem"
            data-item-sync-toggle={conversationId}
            className={menuClass}
            aria-expanded={syncExpanded}
            disabled={busy}
            onClick={() => setSyncExpanded((value) => !value)}
          >
            {t('syncTo')}
            <span className="tw-ml-auto tw-text-[var(--text-secondary)]" aria-hidden="true">
              {syncExpanded ? '▴' : '▾'}
            </span>
          </button>
          {syncExpanded ? (
            <div className="tw-flex tw-flex-col tw-gap-1 tw-pl-2">
              {enabledSyncProviders.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  role="menuitem"
                  data-item-sync-provider={conversationId + ':' + provider}
                  className={menuClass}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await onPopupSyncPreparing?.(provider, []);
                      await syncConversation(conversationId, provider);
                    })
                  }
                >
                  {t(getSyncProviderDefinition(provider)!.labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="tw-border-t tw-border-[var(--border)] tw-pt-1">
        <button
          type="button"
          role="menuitem"
          data-item-delete={conversationId}
          className={menuClass + ' tw-text-[var(--error)]'}
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t('keyboardShortcutsConfirmDeleteItem'))) return;
            run(() => deleteConversation(conversationId));
          }}
        >
          {t('deleteButton')}
          {getShortcut?.('delete-item') ? (
            <span className="tw-ml-auto tw-text-xs tw-text-[var(--text-secondary)]">{getShortcut('delete-item')}</span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
