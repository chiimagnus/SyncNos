type PermissionQuery = { permissions?: string[]; origins?: string[] };
type PermissionChange = { permissions?: string[]; origins?: string[] };

function runtimeLastErrorMessage(fallback: string): string {
  const chrome = (globalThis as any).chrome;
  return String(chrome?.runtime?.lastError?.message || fallback);
}

function normalizePermissions(permissions: string[]): string[] {
  return Array.from(
    new Set((Array.isArray(permissions) ? permissions : []).map((item) => String(item || '').trim()).filter(Boolean)),
  );
}

function permissionQuery(permissions: string[]): PermissionQuery {
  return { permissions: normalizePermissions(permissions) };
}

export function permissionsApiAvailable(): boolean {
  const anyGlobal = globalThis as any;
  const api = anyGlobal.browser?.permissions ?? anyGlobal.chrome?.permissions;
  return !!api?.contains && !!api?.request && !!api?.remove;
}

export async function permissionsContains(permissions: string[]): Promise<boolean> {
  const query = permissionQuery(permissions);
  const anyGlobal = globalThis as any;
  const browserApi = anyGlobal.browser?.permissions;
  if (browserApi?.contains) return (await browserApi.contains(query)) === true;

  const chromeApi = anyGlobal.chrome?.permissions;
  if (!chromeApi?.contains) throw new Error('permissions.contains unavailable');
  return await new Promise<boolean>((resolve, reject) => {
    chromeApi.contains(query, (granted: boolean) => {
      if (anyGlobal.chrome?.runtime?.lastError) {
        reject(new Error(runtimeLastErrorMessage('permissions.contains failed')));
        return;
      }
      resolve(granted === true);
    });
  });
}

export function permissionsRequest(permissions: string[]): Promise<boolean> {
  const query = permissionQuery(permissions);
  const anyGlobal = globalThis as any;
  const browserApi = anyGlobal.browser?.permissions;
  if (browserApi?.request) {
    try {
      return Promise.resolve(browserApi.request(query)).then((granted) => granted === true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const chromeApi = anyGlobal.chrome?.permissions;
  if (!chromeApi?.request) return Promise.reject(new Error('permissions.request unavailable'));
  return new Promise<boolean>((resolve, reject) => {
    try {
      chromeApi.request(query, (granted: boolean) => {
        if (anyGlobal.chrome?.runtime?.lastError) {
          reject(new Error(runtimeLastErrorMessage('permissions.request failed')));
          return;
        }
        resolve(granted === true);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function permissionsRemove(permissions: string[]): Promise<boolean> {
  const query = permissionQuery(permissions);
  const anyGlobal = globalThis as any;
  const browserApi = anyGlobal.browser?.permissions;
  if (browserApi?.remove) return (await browserApi.remove(query)) === true;

  const chromeApi = anyGlobal.chrome?.permissions;
  if (!chromeApi?.remove) throw new Error('permissions.remove unavailable');
  return await new Promise<boolean>((resolve, reject) => {
    chromeApi.remove(query, (removed: boolean) => {
      if (anyGlobal.chrome?.runtime?.lastError) {
        reject(new Error(runtimeLastErrorMessage('permissions.remove failed')));
        return;
      }
      resolve(removed === true);
    });
  });
}

export function permissionsOnRemoved(listener: (change: PermissionChange) => void): () => void {
  if (typeof listener !== 'function') return () => {};
  const anyGlobal = globalThis as any;
  const event = anyGlobal.browser?.permissions?.onRemoved ?? anyGlobal.chrome?.permissions?.onRemoved;
  if (!event?.addListener) return () => {};

  try {
    event.addListener(listener);
  } catch (_error) {
    return () => {};
  }

  return () => {
    try {
      event.removeListener?.(listener);
    } catch (_error) {
      // ignore
    }
  };
}
