import MarkdownIt from 'markdown-it';

let initPromise: Promise<void> | null = null;

export function initLegacyPopupScripts() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const globalAny = globalThis as any;
    if (typeof globalAny.markdownit !== 'function') {
      globalAny.markdownit = (options: any) => new (MarkdownIt as any)(options);
    }

    await import('../../src/shared/runtime-client.js');
    await import('../../src/protocols/message-contracts.js');
    await import('../../src/protocols/conversation-kind-contract.js');
    await import('../../src/protocols/conversation-kinds.js');
    await import('../../src/export/local/article-markdown.js');
    await import('../../src/export/local/zip-utils.js');
    await import('../../src/storage/schema.js');
    await import('../../src/storage/backup-utils.js');
    await import('../../src/export/notion/oauth-config.js');
    await import('../../src/export/notion/notion-api.js');

    await import('../../src/ui/popup/popup-clipboard.js');
    await import('../../src/ui/popup/popup-core.js');
    await import('../../src/ui/popup/popup-conversation-docs.js');
    await import('../../src/ui/popup/popup-obsidian-sync.js');
    await import('../../src/ui/popup/popup-obsidian-sync-state.js');
    await import('../../src/ui/popup/popup-notion-sync-state.js');
    await import('../../src/ui/popup/popup-article-fetch.js');
    await import('../../src/ui/popup/popup-tabs.js');
    await import('../../src/ui/popup/popup-list.js');
    await import('../../src/ui/popup/popup-chat-preview.js');
    await import('../../src/ui/popup/popup-export.js');
    await import('../../src/ui/popup/popup-delete.js');
    await import('../../src/ui/popup/popup-notion.js');
    await import('../../src/ui/popup/popup-database.js');
    await import('../../src/ui/popup/popup-notionai.js');
    await import('../../src/ui/popup/popup-inpage-visibility.js');
    await import('../../src/ui/popup/popup-about.js');
    await import('../../src/ui/popup/popup.js');
  })();
  return initPromise;
}

