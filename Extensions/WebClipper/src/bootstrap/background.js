/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // Load storage schema into this service worker.
  // Note: MV3 SW doesn't share globals with content scripts, so we import explicitly.
  try {
    // eslint-disable-next-line no-undef
    importScripts(
      "../storage/schema.js",
      "../shared/message-contracts.js",
      "../sync/notion/oauth-config.js",
      "../sync/notion/token-store.js",
      "../sync/notion/notion-api.js",
      "../sync/notion/notion-files-api.js",
      "../sync/notion/notion-ai.js",
      "../sync/notion/notion-db-manager.js",
      "../sync/notion/notion-sync-service.js",
      "../sync/obsidian/obsidian-url-service.js",
      "./background-storage.js",
      "./background-notion-oauth.js",
      "./background-router.js"
    );
  } catch (_e) {
    // ignore
  }

  const router = NS.backgroundRouter;
  router && router.start && router.start();
})();
