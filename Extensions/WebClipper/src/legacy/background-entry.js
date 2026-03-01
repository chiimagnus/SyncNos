export async function startLegacyBackground() {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // Keep the load order aligned with `src/bootstrap/background.js` importScripts list.
  const modules = [
    "../storage/schema.js",
    "../protocols/message-contracts.js",
    "../protocols/conversation-kind-contract.js",
    "../protocols/conversation-kinds.js",
    "../export/notion/oauth-config.js",
    "../export/notion/token-store.js",
    "../export/notion/notion-api.js",
    "../export/notion/notion-files-api.js",
    "../export/notion/notion-ai.js",
    "../export/notion/notion-db-manager.js",
    "../export/notion/notion-markdown-blocks.js",
    "../export/notion/notion-image-upload-upgrader.js",
    "../export/notion/notion-sync-service.js",
    "../export/notion/notion-sync-job-store.js",
    "../export/notion/notion-sync-orchestrator.js",
    "../export/obsidian/obsidian-settings-store.js",
    "../export/obsidian/obsidian-local-rest-client.js",
    "../export/obsidian/obsidian-note-path.js",
    "../export/obsidian/obsidian-sync-metadata.js",
    "../export/obsidian/obsidian-markdown-writer.js",
    "../export/obsidian/obsidian-sync-orchestrator.js",
    "../bootstrap/background-inpage-web-visibility.js",
    "../bootstrap/background-events-hub.js",
    "../bootstrap/background-storage.js",
    "../bootstrap/background-notion-oauth.js",
    "../collectors/web/article-fetch-service.js",
    "../bootstrap/background-router.js",
  ];

  for (const specifier of modules) {
    // These legacy modules are side-effect scripts that attach to globalThis.WebClipper.
    // eslint-disable-next-line no-await-in-loop
    await import(specifier);
  }

  try {
    NS.backgroundInpageWebVisibility?.start?.();
  } catch (_e) {
    // ignore
  }

  try {
    NS.backgroundRouter?.start?.();
  } catch (_e) {
    // ignore
  }
}

