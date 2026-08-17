import { LOCAL_DATA_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { createRuntimeClient } from '@services/shared/runtime-client';
import { parseLocalDataMigrationStatus, type LocalDataMigrationStatus } from './migration-status';

type MigrationRuntimeClient = Readonly<{
  send: (type: string, payload?: Record<string, unknown>) => Promise<unknown>;
}>;

export type LocalDataMigrationClient = Readonly<{
  getFactsRevision: () => Promise<number | null>;
  getStatus: () => Promise<LocalDataMigrationStatus>;
  resume: () => Promise<LocalDataMigrationStatus>;
  start: () => Promise<LocalDataMigrationStatus>;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid local data migration response');
  return value as Record<string, unknown>;
}

function unwrapData(value: unknown): unknown {
  const response = record(value);
  if (response.ok === true) return response.data;
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

function unwrapStatus(value: unknown): LocalDataMigrationStatus {
  return parseLocalDataMigrationStatus(unwrapData(value));
}

export function createLocalDataMigrationClient(
  runtime: MigrationRuntimeClient = createRuntimeClient(),
): LocalDataMigrationClient {
  const request = async (type: string) => unwrapStatus(await runtime.send(type));
  return Object.freeze({
    getFactsRevision: async () => {
      const data = record(unwrapData(await runtime.send(LOCAL_DATA_MESSAGE_TYPES.GET_FACTS_REVISION)));
      if (Object.keys(data).sort().join(',') !== 'factsRevision') throw new Error('invalid local data facts revision');
      if (data.factsRevision === null) return null;
      if (!Number.isSafeInteger(data.factsRevision) || Number(data.factsRevision) < 0) {
        throw new Error('invalid local data facts revision');
      }
      return Number(data.factsRevision);
    },
    getStatus: async () => await request(LOCAL_DATA_MESSAGE_TYPES.GET_STATUS),
    start: async () => await request(LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION),
    resume: async () => await request(LOCAL_DATA_MESSAGE_TYPES.RESUME_MIGRATION),
  });
}

const defaultClient = createLocalDataMigrationClient();

export const getLocalDataFactsRevision = defaultClient.getFactsRevision;
export const getLocalDataMigrationStatus = defaultClient.getStatus;
export const startLocalDataMigration = defaultClient.start;
export const resumeLocalDataMigration = defaultClient.resume;
