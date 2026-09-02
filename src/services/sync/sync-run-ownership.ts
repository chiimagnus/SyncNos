export function createSyncAlreadyRunningError(): Error & { code: 'sync_already_running' } {
  return Object.assign(new Error('sync already in progress'), { code: 'sync_already_running' as const });
}

type OwnerKind = 'run' | 'maintenance';

type Owner = {
  kind: OwnerKind;
  token: symbol;
};

export function createSyncRunOwnership() {
  let owner: Owner | null = null;

  const start = <T>(kind: OwnerKind, factory: () => T | Promise<T>): Promise<T> => {
    if (owner) throw createSyncAlreadyRunningError();

    const current: Owner = { kind, token: Symbol(kind) };
    owner = current;

    let result: Promise<T>;
    try {
      result = Promise.resolve(factory());
    } catch (error) {
      if (owner?.token === current.token) owner = null;
      throw error;
    }

    return result.finally(() => {
      if (owner?.token === current.token) owner = null;
    });
  };

  return {
    startRun: <T>(factory: () => T | Promise<T>) => start('run', factory),
    runExclusiveMutation: <T>(factory: () => T | Promise<T>) => start('maintenance', factory),
    isRunActive: () => owner?.kind === 'run',
  };
}

export type SyncRunOwnership = ReturnType<typeof createSyncRunOwnership>;
