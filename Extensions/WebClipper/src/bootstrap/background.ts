/* eslint-disable import/no-unresolved */

import '../export/bootstrap.ts';

import '../sync/notion/notion-api.ts';
import '../sync/notion/notion-files-api.ts';
import '../sync/notion/notion-ai.ts';
import '../sync/notion/notion-db-manager.ts';
import '../sync/notion/notion-markdown-blocks.ts';
import '../sync/notion/notion-image-upload-upgrader.ts';
import '../sync/notion/notion-sync-service.ts';
import '../sync/notion/notion-sync-job-store.ts';
import '../sync/notion/notion-sync-orchestrator.ts';

import '../sync/obsidian/obsidian-local-rest-client.ts';
import '../sync/obsidian/obsidian-note-path.ts';
import '../sync/obsidian/obsidian-sync-metadata.ts';
import '../sync/obsidian/obsidian-markdown-writer.ts';
import '../sync/obsidian/obsidian-sync-orchestrator.ts';

import './background-inpage-web-visibility.ts';
import '../collectors/web/article-fetch-service.ts';
import runtimeContext from '../runtime-context.ts';

export function startBackgroundBootstrap() {
  try {
    runtimeContext.backgroundInpageWebVisibility?.start?.();
  } catch (_e) {
    // ignore
  }
}
