import { type CliFactsRequest } from '@services/local-data/contracts';

import { openReadOnly, type DatabaseOpenInput } from '../sqlite/database';
import { createSearchRepository } from '../sqlite/search';

type SearchCliRequest = Extract<CliFactsRequest, Readonly<{ command: 'SEARCH_CONVERSATIONS' }>>;

export type RunSearchInput = Readonly<{
  database?: DatabaseOpenInput;
  openReadOnly?: typeof openReadOnly;
  request: SearchCliRequest;
}>;

/** Runs one bounded search through the existing repository; its cursor is a CLI-safe token string. */
export async function runSearch(input: RunSearchInput): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof openReadOnly>> | null = null;
  try {
    handle = await (input.openReadOnly ?? openReadOnly)(input.database);
    const page = createSearchRepository(handle.database).searchConversations(input.request.payload);
    return Object.freeze({ ...page, cursor: page.cursor?.token ?? null });
  } finally {
    try {
      handle?.close();
    } catch (_error) {
      // The one-shot command has no reusable handle after its result is determined.
    }
  }
}
