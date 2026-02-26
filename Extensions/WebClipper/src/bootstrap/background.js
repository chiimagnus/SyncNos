/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // Load storage schema into this service worker.
  // Note: MV3 SW doesn't share globals with content scripts, so we import explicitly.
  try {
    // eslint-disable-next-line no-undef
    importScripts(
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
      "../export/obsidian/obsidian-url-service.js",
      "./background-events-hub.js",
      "./background-storage.js",
      "./background-notion-oauth.js",
      "../collectors/web/article-fetch-service.js",
      "./background-router.js"
    );
  } catch (_e) {
    // ignore
  }

  const router = NS.backgroundRouter;
  router && router.start && router.start();
})();
