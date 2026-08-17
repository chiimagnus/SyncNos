import { LocalDataContractError, type CliFactsCommand } from '@services/local-data/contracts';

export type CliFormat = 'json' | 'table';

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidArgument();
  return value as Record<string, unknown>;
}

function cell(value: unknown): string {
  let rendered = '';
  for (const character of String(value ?? '')) {
    if (character === '\\') {
      rendered += '\\\\';
      continue;
    }
    if (character === '\t') {
      rendered += '\\t';
      continue;
    }
    if (character === '\r') {
      rendered += '\\r';
      continue;
    }
    if (character === '\n') {
      rendered += '\\n';
      continue;
    }
    if (character === '|') {
      rendered += '\\|';
      continue;
    }
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      rendered += `\\x${codePoint.toString(16).padStart(2, '0')}`;
      continue;
    }
    rendered += character;
  }
  return rendered;
}

function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `${headers.map(cell).join(' | ')}\n${rows.map((row) => row.map(cell).join(' | ')).join('\n')}\n`;
}

function listTable(data: unknown): string {
  const items = record(data).items;
  if (!Array.isArray(items)) invalidArgument();
  return table(
    ['ID', 'SOURCE', 'SITE', 'LAST_CAPTURED_AT', 'TITLE'],
    items.map((item) => {
      const row = record(item);
      return [row.id, row.source, row.listSiteKey, row.lastCapturedAt, row.title];
    }),
  );
}

function searchTable(data: unknown): string {
  const items = record(data).items;
  if (!Array.isArray(items)) invalidArgument();
  return table(
    ['ID', 'SOURCE', 'SITE', 'SCORE', 'LAST_CAPTURED_AT', 'TITLE', 'SNIPPET'],
    items.map((item) => {
      const row = record(item);
      return [
        row.backendConversationId,
        row.source,
        row.siteKey,
        row.score,
        row.lastCapturedAt,
        row.title,
        row.snippet,
      ];
    }),
  );
}

/** Table rendering is deliberately post-query only, so it cannot alter filters, pagination, or error semantics. */
export function formatCliTable(command: CliFactsCommand, data: unknown): string {
  switch (command) {
    case 'CONVERSATIONS_LIST':
      return listTable(data);
    case 'SEARCH_CONVERSATIONS':
      return searchTable(data);
    default:
      invalidArgument();
  }
}
