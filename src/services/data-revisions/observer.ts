import { storageOnChanged } from '@platform/storage/local';
import {
  DATA_REVISION_SCOPES,
  getDataRevisionSnapshot,
  type DataRevisionScope,
  type DataRevisionSnapshot,
} from '@services/data-revisions/client';
import { DATA_REVISION_WAKE_STORAGE_KEY, subscribeDataRevisionWake } from '@services/data-revisions/wake';

export const DATA_REVISION_READINESS_TIMEOUT_MS = 2_000;
export const DATA_REVISION_SAFETY_RECONCILE_MS = 30_000;

export type DataRevisionObserverReadiness = { baselineAvailable: boolean };
export type DataRevisionChangeListener = (scopes: readonly DataRevisionScope[]) => void;

type DataRevisionObserverDeps = {
  readSnapshot?: () => Promise<DataRevisionSnapshot>;
  subscribeWake?: (listener: () => void) => () => void;
  subscribeStorage?: (listener: (changes: any, areaName: string) => void) => () => void;
  getDocument?: () => Document | null | undefined;
  getWindow?: () => Window | null | undefined;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  readinessTimeoutMs?: number;
  safetyReconcileMs?: number;
};

type ObserverEpoch = {
  checkpoint: DataRevisionSnapshot | null;
  baselineAttempted: boolean;
  baselineUncertain: boolean;
  inFlight: boolean;
  trailing: boolean;
  readySettled: boolean;
  resolveReady: (readiness: DataRevisionObserverReadiness) => void;
  ready: Promise<DataRevisionObserverReadiness>;
  readinessTimer: ReturnType<typeof setTimeout> | null;
  safetyTimer: ReturnType<typeof setInterval> | null;
  disposeListeners: Array<() => void>;
};

function changedScopes(previous: DataRevisionSnapshot, next: DataRevisionSnapshot): DataRevisionScope[] {
  return DATA_REVISION_SCOPES.filter((scope) => previous[scope] !== next[scope]);
}

function allScopes(): DataRevisionScope[] {
  return [...DATA_REVISION_SCOPES];
}

function safeDelay(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

export function createDataRevisionObserver(deps: DataRevisionObserverDeps = {}) {
  const readSnapshot = deps.readSnapshot || getDataRevisionSnapshot;
  const subscribeWake = deps.subscribeWake || subscribeDataRevisionWake;
  const subscribeStorage = deps.subscribeStorage || storageOnChanged;
  const getDocument = deps.getDocument || (() => globalThis.document);
  const getWindow = deps.getWindow || (() => globalThis.window);
  const setTimer = deps.setTimeout || globalThis.setTimeout.bind(globalThis);
  const clearTimer = deps.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const setSafetyTimer = deps.setInterval || globalThis.setInterval.bind(globalThis);
  const clearSafetyTimer = deps.clearInterval || globalThis.clearInterval.bind(globalThis);
  const readinessTimeoutMs = safeDelay(deps.readinessTimeoutMs, DATA_REVISION_READINESS_TIMEOUT_MS);
  const safetyReconcileMs = safeDelay(deps.safetyReconcileMs, DATA_REVISION_SAFETY_RECONCILE_MS);

  const listeners = new Set<{ listener: DataRevisionChangeListener }>();
  let activeEpoch: ObserverEpoch | null = null;

  const isActiveEpoch = (epoch: ObserverEpoch) => activeEpoch === epoch;

  const settleReadiness = (epoch: ObserverEpoch, baselineAvailable: boolean) => {
    if (!isActiveEpoch(epoch) || epoch.readySettled) return;
    epoch.readySettled = true;
    if (epoch.readinessTimer != null) {
      clearTimer(epoch.readinessTimer);
      epoch.readinessTimer = null;
    }
    epoch.resolveReady({ baselineAvailable });
  };

  const notify = (scopes: readonly DataRevisionScope[]) => {
    if (!scopes.length) return;
    for (const subscription of Array.from(listeners)) {
      try {
        subscription.listener(scopes);
      } catch (_error) {}
    }
  };

  const reconcile = (epoch: ObserverEpoch) => {
    if (!isActiveEpoch(epoch)) return;
    if (epoch.inFlight) {
      epoch.trailing = true;
      return;
    }

    const isBaseline = !epoch.baselineAttempted;
    epoch.baselineAttempted = true;
    epoch.inFlight = true;
    void Promise.resolve()
      .then(() => readSnapshot())
      .then(
        (snapshot) => {
          if (!isActiveEpoch(epoch)) return;

          const previous = epoch.checkpoint;
          const catchUp = epoch.baselineUncertain;
          epoch.checkpoint = snapshot;
          if (isBaseline) settleReadiness(epoch, true);
          if (catchUp) {
            epoch.baselineUncertain = false;
            notify(allScopes());
          } else if (previous) {
            notify(changedScopes(previous, snapshot));
          }
        },
        () => {
          if (!isActiveEpoch(epoch)) return;
          if (isBaseline) {
            epoch.baselineUncertain = true;
            settleReadiness(epoch, false);
          }
        },
      )
      .finally(() => {
        if (!isActiveEpoch(epoch)) return;
        epoch.inFlight = false;
        if (!epoch.trailing) return;
        epoch.trailing = false;
        reconcile(epoch);
      });
  };

  const clearSafetyReconcile = (epoch: ObserverEpoch) => {
    if (epoch.safetyTimer == null) return;
    clearSafetyTimer(epoch.safetyTimer);
    epoch.safetyTimer = null;
  };

  const isVisible = () => {
    const documentLike = getDocument();
    return !documentLike || documentLike.visibilityState !== 'hidden';
  };

  const startSafetyReconcile = (epoch: ObserverEpoch) => {
    if (!isActiveEpoch(epoch) || !isVisible() || epoch.safetyTimer != null) return;
    epoch.safetyTimer = setSafetyTimer(() => reconcile(epoch), safetyReconcileMs);
  };

  const stopEpoch = (epoch: ObserverEpoch) => {
    if (!isActiveEpoch(epoch)) return;
    activeEpoch = null;
    if (epoch.readinessTimer != null) clearTimer(epoch.readinessTimer);
    epoch.readinessTimer = null;
    clearSafetyReconcile(epoch);
    for (const dispose of epoch.disposeListeners.splice(0)) {
      try {
        dispose();
      } catch (_error) {}
    }
  };

  const startEpoch = () => {
    let resolveReady: (readiness: DataRevisionObserverReadiness) => void = () => {};
    const epoch: ObserverEpoch = {
      checkpoint: null,
      baselineAttempted: false,
      baselineUncertain: false,
      inFlight: false,
      trailing: false,
      readySettled: false,
      resolveReady,
      ready: Promise.resolve({ baselineAvailable: false }),
      readinessTimer: null,
      safetyTimer: null,
      disposeListeners: [],
    };
    epoch.ready = new Promise<DataRevisionObserverReadiness>((resolve) => {
      epoch.resolveReady = resolve;
    });
    activeEpoch = epoch;

    epoch.disposeListeners.push(subscribeWake(() => reconcile(epoch)));
    epoch.disposeListeners.push(
      subscribeStorage((changes: any, areaName: string) => {
        if (areaName !== 'local' || !changes || typeof changes !== 'object') return;
        if (!Object.prototype.hasOwnProperty.call(changes, DATA_REVISION_WAKE_STORAGE_KEY)) return;
        reconcile(epoch);
      }),
    );

    const documentLike = getDocument();
    const windowLike = getWindow();
    const onVisibilityChange = () => {
      if (!isActiveEpoch(epoch)) return;
      if (isVisible()) {
        startSafetyReconcile(epoch);
        reconcile(epoch);
      } else {
        clearSafetyReconcile(epoch);
      }
    };
    const onLifecycleSignal = () => reconcile(epoch);
    if (documentLike?.addEventListener) {
      documentLike.addEventListener('visibilitychange', onVisibilityChange);
      epoch.disposeListeners.push(() => documentLike.removeEventListener('visibilitychange', onVisibilityChange));
    }
    if (windowLike?.addEventListener) {
      windowLike.addEventListener('focus', onLifecycleSignal);
      windowLike.addEventListener('pageshow', onLifecycleSignal);
      epoch.disposeListeners.push(() => {
        windowLike.removeEventListener('focus', onLifecycleSignal);
        windowLike.removeEventListener('pageshow', onLifecycleSignal);
      });
    }
    startSafetyReconcile(epoch);
    epoch.readinessTimer = setTimer(() => {
      if (!isActiveEpoch(epoch) || epoch.readySettled) return;
      epoch.baselineUncertain = true;
      settleReadiness(epoch, false);
    }, readinessTimeoutMs);
    reconcile(epoch);
  };

  return {
    subscribe(listener: DataRevisionChangeListener): () => void {
      if (typeof listener !== 'function') return () => {};
      const shouldStart = listeners.size === 0;
      const subscription = { listener };
      listeners.add(subscription);
      if (shouldStart) startEpoch();

      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(subscription);
        if (!listeners.size && activeEpoch) stopEpoch(activeEpoch);
      };
    },
    whenReady(): Promise<DataRevisionObserverReadiness> {
      return activeEpoch?.ready || Promise.resolve({ baselineAvailable: false });
    },
    requestReconcile(): void {
      if (activeEpoch) reconcile(activeEpoch);
    },
  };
}

const defaultObserver = createDataRevisionObserver();

export const subscribeDataRevisionChanges = defaultObserver.subscribe;
export const whenDataRevisionObserverReady = defaultObserver.whenReady;
export const requestDataRevisionReconcile = defaultObserver.requestReconcile;
