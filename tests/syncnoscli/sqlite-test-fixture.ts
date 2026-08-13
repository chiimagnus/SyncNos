import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCommentsRepository } from '../../packages/syncnoscli/src/sqlite/comments-repository';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost, type SyncNosSqliteHandle } from '../../packages/syncnoscli/src/sqlite/database';
import { createImagesRepository } from '../../packages/syncnoscli/src/sqlite/images-repository';
import { createMappingsRepository } from '../../packages/syncnoscli/src/sqlite/mappings-repository';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { createSearchRepository } from '../../packages/syncnoscli/src/sqlite/search';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

/** Shares only temporary SQLite lifecycle plumbing; each test still uses production repositories. */
export function createSqliteTestFixture(prefix: string) {
  const handles: SyncNosSqliteHandle[] = [];
  const roots: string[] = [];

  return Object.freeze({
    async cleanup(): Promise<void> {
      for (const handle of handles.splice(0)) handle.close();
      await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    },
    async open() {
      const root = await mkdtemp(join(tmpdir(), prefix));
      roots.push(root);
      const paths = resolveSyncNosRuntimePaths({ homeDirectory: root });
      const handle = await openReadWriteForHost({ paths });
      handles.push(handle);
      return Object.freeze({
        comments: createCommentsRepository(handle.database),
        conversations: createConversationsRepository(handle.database),
        database: handle.database,
        handle,
        images: createImagesRepository(handle.database),
        mappings: createMappingsRepository(handle.database),
        messages: createMessagesRepository(handle.database),
        paths,
        search: createSearchRepository(handle.database),
      });
    },
  });
}
