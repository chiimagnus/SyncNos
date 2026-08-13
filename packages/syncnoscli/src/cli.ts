import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  createSearchCursorBinding,
  createCliJsonFailure,
  createCliJsonSuccess,
  normalizeSearchQuery,
  parseCliFactsRequest,
  type CliFactsCommand,
  type CliFactsRequest,
} from '@services/local-data/contracts';

import { runConversations, type RunConversationsInput } from './commands/conversations';
import { runDoctor, type RunDoctorInput } from './commands/doctor';
import { formatCliTable, type CliFormat } from './commands/format';
import { runSearch, type RunSearchInput } from './commands/search';
import { runStats, type RunStatsInput } from './commands/stats';
import type { DatabaseOpenInput } from './sqlite/database';

declare const __SYNCNOSCLI_VERSION__: string;

const HELP = `SyncNos CLI\n\nUsage:\n  syncnoscli --help\n  syncnoscli --version\n  syncnoscli doctor [--fix]\n  syncnoscli conversations list [--cursor <cursor>] [--source <source>] [--site <site>] [--page-size <1-200>] [--format json|table]\n  syncnoscli conversations get <id>\n  syncnoscli stats\n  syncnoscli search <query> [--cursor <cursor>] [--source <source>] [--site <site>] [--sort best|recent] [--page-size <1-200>] [--format json|table]\n\nData commands are read-only and on-demand. Protocol envelope: v${LOCAL_DATA_PROTOCOL_VERSION}\n`;

type CliOutput = Readonly<{ write: (chunk: string) => boolean }>;

type ParsedCliInvocation = Readonly<{
  format: CliFormat;
  request: CliFactsRequest;
}>;

type FlagValues = Readonly<Record<string, string>>;

export type RunCliInput = Readonly<{
  database?: DatabaseOpenInput;
  runConversations?: (input: RunConversationsInput) => Promise<unknown>;
  runDoctor?: (input: RunDoctorInput) => Promise<unknown>;
  runSearch?: (input: RunSearchInput) => Promise<unknown>;
  runStats?: (input: RunStatsInput) => Promise<unknown>;
  stdout?: CliOutput;
}>;

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function request<TCommand extends CliFactsCommand>(
  command: TCommand,
  payload: unknown,
  requestId: string,
): CliFactsRequest {
  return parseCliFactsRequest({
    command,
    payload,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    requestId,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  });
}

function parseFlags(argv: readonly string[], allowed: readonly string[]): FlagValues {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || argument.length === 2) invalidArgument();
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!allowed.includes(name) || Object.hasOwn(values, name) || !value || value.startsWith('--')) invalidArgument();
    values[name] = value;
    index += 1;
  }
  return Object.freeze(values);
}

function parseFormat(values: FlagValues): CliFormat {
  const value = values.format;
  if (value === undefined) return 'json';
  if (value === 'json' || value === 'table') return value;
  invalidArgument();
}

function optionalListPayload(values: FlagValues) {
  return {
    ...(values.cursor ? { cursor: values.cursor } : null),
    ...(values['page-size'] ? { limit: Number(values['page-size']) } : null),
    ...(values.site ? { siteKey: values.site } : null),
    ...(values.source ? { sourceKey: values.source } : null),
  };
}

function parseDoctor(argv: readonly string[]): ParsedCliInvocation {
  if (argv.length === 0) return Object.freeze({ format: 'json', request: request('DOCTOR', {}, 'cli:doctor') });
  if (argv.length === 1 && argv[0] === '--fix') {
    return Object.freeze({ format: 'json', request: request('DOCTOR', { fix: true }, 'cli:doctor') });
  }
  invalidArgument();
}

function parseConversations(argv: readonly string[]): ParsedCliInvocation {
  if (argv[0] === 'list') {
    const flags = parseFlags(argv.slice(1), ['cursor', 'source', 'site', 'page-size', 'format']);
    return Object.freeze({
      format: parseFormat(flags),
      request: request('CONVERSATIONS_LIST', optionalListPayload(flags), 'cli:conversations-list'),
    });
  }
  if (argv[0] === 'get' && argv.length === 2) {
    return Object.freeze({
      format: 'json',
      request: request('CONVERSATIONS_GET', { id: Number(argv[1]) }, 'cli:conversations-get'),
    });
  }
  invalidArgument();
}

function parseSearch(argv: readonly string[]): ParsedCliInvocation {
  const query = argv[0];
  if (!query || query.startsWith('--')) invalidArgument();
  const flags = parseFlags(argv.slice(1), ['cursor', 'source', 'site', 'sort', 'page-size', 'format']);
  const listPayload = optionalListPayload(flags);
  const normalizedQuery = normalizeSearchQuery(query);
  return Object.freeze({
    format: parseFormat(flags),
    request: request(
      'SEARCH_CONVERSATIONS',
      {
        ...(listPayload.cursor ? { cursor: createSearchCursorBinding(normalizedQuery, listPayload.cursor) } : null),
        ...(listPayload.limit ? { limit: listPayload.limit } : null),
        query: normalizedQuery,
        ...(flags.site ? { siteKey: flags.site } : null),
        ...(flags.sort ? { sort: flags.sort } : null),
        ...(flags.source ? { sourceKey: flags.source } : null),
      },
      'cli:search',
    ),
  });
}

function parseInvocation(argv: readonly string[]): ParsedCliInvocation {
  switch (argv[0]) {
    case 'doctor':
      return parseDoctor(argv.slice(1));
    case 'conversations':
      return parseConversations(argv.slice(1));
    case 'stats':
      if (argv.length !== 1) invalidArgument();
      return Object.freeze({ format: 'json', request: request('STATS', {}, 'cli:stats') });
    case 'search':
      return parseSearch(argv.slice(1));
    default:
      invalidArgument();
  }
}

function requestIdForInvalidInvocation(argv: readonly string[]): string {
  if (argv[0] === 'doctor') return 'cli:doctor';
  if (argv[0] === 'conversations' && argv[1] === 'list') return 'cli:conversations-list';
  if (argv[0] === 'conversations' && argv[1] === 'get') return 'cli:conversations-get';
  if (argv[0] === 'stats') return 'cli:stats';
  if (argv[0] === 'search') return 'cli:search';
  return 'cli:invalid';
}

function errorCode(error: unknown) {
  return error instanceof LocalDataContractError ? error.code : 'INVALID_ARGUMENT';
}

async function runRequest(requestValue: CliFactsRequest, input: RunCliInput): Promise<unknown> {
  switch (requestValue.command) {
    case 'DOCTOR':
      return await (input.runDoctor ?? runDoctor)({ fix: requestValue.payload.fix ?? false });
    case 'CONVERSATIONS_LIST':
    case 'CONVERSATIONS_GET':
      return await (input.runConversations ?? runConversations)({ database: input.database, request: requestValue });
    case 'STATS':
      return await (input.runStats ?? runStats)({ database: input.database, request: requestValue });
    case 'SEARCH_CONVERSATIONS':
      return await (input.runSearch ?? runSearch)({ database: input.database, request: requestValue });
    default:
      invalidArgument();
  }
}

export async function runCli(argv = process.argv.slice(2), input: RunCliInput = {}): Promise<number> {
  const stdout = input.stdout ?? process.stdout;
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))) {
    stdout.write(HELP);
    return 0;
  }

  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    stdout.write(`${__SYNCNOSCLI_VERSION__}\n`);
    return 0;
  }

  let invocation: ParsedCliInvocation;
  try {
    invocation = parseInvocation(argv);
  } catch (error) {
    stdout.write(json(createCliJsonFailure(requestIdForInvalidInvocation(argv), errorCode(error))));
    return 2;
  }

  try {
    const data = await runRequest(invocation.request, input);
    if (invocation.format === 'table') {
      stdout.write(formatCliTable(invocation.request.command, data));
    } else {
      stdout.write(json(createCliJsonSuccess(invocation.request.requestId, data)));
    }
    return 0;
  } catch (error) {
    stdout.write(json(createCliJsonFailure(invocation.request.requestId, errorCode(error))));
    return 1;
  }
}

if (require.main === module) {
  void runCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
