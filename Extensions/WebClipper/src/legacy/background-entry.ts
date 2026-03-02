/* eslint-disable import/no-unresolved */

// Legacy background bootstrap (migration-only).
//
// IMPORTANT: Do not use dynamic `import()` in MV3 service workers. Chrome disallows it on
// ServiceWorkerGlobalScope. Use static imports so Vite/Rollup bundles legacy code into `background.js`.

import '../protocols/bootstrap.ts';
import '../export/bootstrap.ts';

import '../export/notion/notion-api.js';
import '../export/notion/notion-files-api.js';
import '../export/notion/notion-ai.js';
import '../export/notion/notion-db-manager.js';
import '../export/notion/notion-markdown-blocks.js';
import '../export/notion/notion-image-upload-upgrader.js';
import '../export/notion/notion-sync-service.js';
import '../export/notion/notion-sync-job-store.js';
import '../export/notion/notion-sync-orchestrator.js';

import '../export/obsidian/obsidian-local-rest-client.js';
import '../export/obsidian/obsidian-note-path.js';
import '../export/obsidian/obsidian-sync-metadata.js';
import '../export/obsidian/obsidian-markdown-writer.js';
import '../export/obsidian/obsidian-sync-orchestrator.js';

import '../bootstrap/background-inpage-web-visibility.js';
import '../collectors/web/article-fetch-service.js';
import '../bootstrap/background-router.js';

export function startLegacyBackground() {
  const NS = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

  try {
    NS.backgroundInpageWebVisibility?.start?.();
  } catch (_e) {
    // ignore
  }
}
