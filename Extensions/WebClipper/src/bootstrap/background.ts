/* eslint-disable import/no-unresolved */

import '../export/bootstrap.ts';

import '../export/notion/notion-api.ts';
import '../export/notion/notion-files-api.ts';
import '../export/notion/notion-ai.ts';
import '../export/notion/notion-db-manager.ts';
import '../export/notion/notion-markdown-blocks.ts';
import '../export/notion/notion-image-upload-upgrader.ts';
import '../export/notion/notion-sync-service.ts';
import '../export/notion/notion-sync-job-store.ts';
import '../export/notion/notion-sync-orchestrator.ts';

import '../export/obsidian/obsidian-local-rest-client.ts';
import '../export/obsidian/obsidian-note-path.ts';
import '../export/obsidian/obsidian-sync-metadata.ts';
import '../export/obsidian/obsidian-markdown-writer.ts';
import '../export/obsidian/obsidian-sync-orchestrator.ts';

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
