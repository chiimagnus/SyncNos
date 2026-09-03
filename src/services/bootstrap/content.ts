import {
  INPAGE_DISPLAY_MODE_STORAGE_KEY,
  normalizeInpageDisplayMode,
  readEffectiveInpageDisplayMode,
  type InpageDisplayMode,
} from '@services/shared/inpage-display-mode';
import { storageOnChanged } from '@services/shared/storage';

type RuntimeClient = {
  onInvalidated?: (listener: (error: Error) => void) => () => void;
  getURL?: (path: string) => string;
};

type ControllerFactory = {
  start: () => { stop?: () => void } | null;
};

type StartContentBootstrapInput = {
  runtime: RuntimeClient | null;
  createController: () => ControllerFactory;
  inpageButton?: { initRuntime?: (runtime: { getURL?: (path: string) => string } | null) => void };
};

const SUPPORTED_HOST_SUFFIXES = Object.freeze([
  'chat.openai.com',
  'chatgpt.com',
  'www.chatgpt.com',
  'gemini.google.com',
  'aistudio.google.com',
  'makersuite.google.com',
  'chat.deepseek.com',
  'chat.z.ai',
  'kimi.moonshot.cn',
  'kimi.com',
  'doubao.com',
  'yuanbao.tencent.com',
  'poe.com',
  'notion.so',
  'app.notion.com',
]);

function isSupportedHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const suffix of SUPPORTED_HOST_SUFFIXES) {
    if (host === suffix) return true;
    if (host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

export function startContentBootstrap(input: StartContentBootstrapInput) {
  const runtime = input.runtime || null;
  const inpageButton = input.inpageButton;
  const wrapper = input.createController();
  const supportedHost = isSupportedHost(globalThis.location?.hostname || '');
  let active: { stop?: () => void } | null = null;
  let disposed = false;
  let modeGeneration = 0;
  let removeRuntimeInvalidation = () => {};
  let removeDisplayListener = () => {};

  function startController() {
    if (disposed) return;
    try {
      active = wrapper?.start?.() || null;
    } catch (_e) {
      active = null;
    }
  }

  function stopController() {
    const previous = active;
    active = null;
    try {
      previous?.stop?.();
    } catch (_e) {
      // ignore
    }
  }

  function applyDisplayMode(mode: InpageDisplayMode) {
    if (disposed) return;
    if (mode === 'off') {
      if (active) stopController();
      return;
    }

    if (mode === 'supported') {
      if (supportedHost) {
        if (!active) startController();
      } else if (active) {
        stopController();
      }
      return;
    }

    if (!active) startController();
  }

  function applyEffectiveRead(generation: number) {
    void readEffectiveInpageDisplayMode().then(
      (mode) => {
        if (!disposed && modeGeneration === generation) applyDisplayMode(mode);
      },
      () => {
        if (!disposed && modeGeneration === generation) applyDisplayMode('all');
      },
    );
  }

  function stop() {
    if (disposed) return;
    disposed = true;
    modeGeneration += 1;
    removeRuntimeInvalidation();
    removeDisplayListener();
    stopController();
  }

  removeRuntimeInvalidation = runtime?.onInvalidated?.(() => stop()) || (() => {});

  try {
    inpageButton?.initRuntime?.(runtime);
  } catch (_e) {
    // ignore
  }

  if (!disposed) {
    removeDisplayListener = storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, INPAGE_DISPLAY_MODE_STORAGE_KEY)) return;
      const generation = ++modeGeneration;
      const normalized = normalizeInpageDisplayMode(changes[INPAGE_DISPLAY_MODE_STORAGE_KEY]?.newValue);
      if (normalized) {
        applyDisplayMode(normalized);
        return;
      }
      applyEffectiveRead(generation);
    });

    const initialGeneration = modeGeneration;
    applyEffectiveRead(initialGeneration);
  }

  return { stop };
}
