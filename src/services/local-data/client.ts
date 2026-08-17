import { LOCAL_DATA_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { createRuntimeClient } from '@services/shared/runtime-client';
import { parseLocalDataMigrationStatus, type LocalDataMigrationStatus } from './migration-status';

type MigrationRuntimeClient = Readonly<{
  send: (type: string, payload?: Record<string, unknown>) => Promise<unknown>;
}>;

export type LocalDataMigrationClient = Readonly<{
  getStatus: () => Promise<LocalDataMigrationStatus>;
  resume: () => Promise<LocalDataMigrationStatus>;
  start: () => Promise<LocalDataMigrationStatus>;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid local data migration response');
  return value as Record<string, unknown>;
}

function unwrapStatus(value: unknown): LocalDataMigrationStatus {
  const response = record(value);
  if (response.ok === true) return parseLocalDataMigrationStatus(response.data);
  const error = record(response.error);
  const message =
    typeof error.message === 'string' && error.message.trim() ? error.message : 'local data migration failed';
  const result = new Error(message) as Error & { code?: string; diagnostics?: unknown };
  const extra =
    error.extra && typeof error.extra === 'object' && !Array.isArray(error.extra)
      ? (error.extra as Record<string, unknown>)
      : null;
  if (extra && typeof extra.code === 'string') result.code = extra.code;
  if (extra && Object.hasOwn(extra, 'diagnostics')) result.diagnostics = extra.diagnostics;
  throw result;
}

export function createLocalDataMigrationClient(
  runtime: MigrationRuntimeClient = createRuntimeClient(),
): LocalDataMigrationClient {
  const request = async (type: string) => unwrapStatus(await runtime.send(type));
  return Object.freeze({
    getStatus: async () => await request(LOCAL_DATA_MESSAGE_TYPES.GET_STATUS),
    start: async () => await request(LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION),
    resume: async () => await request(LOCAL_DATA_MESSAGE_TYPES.RESUME_MIGRATION),
  });
}

const defaultClient = createLocalDataMigrationClient();

export const getLocalDataMigrationStatus = defaultClient.getStatus;
export const startLocalDataMigration = defaultClient.start;
export const resumeLocalDataMigration = defaultClient.resume;
