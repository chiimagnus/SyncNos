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

const STORAGE_KEY_SUPPORTED_ONLY = 'inpage_supported_only';
const STORAGE_KEY_DISPLAY_MODE = 'inpage_display_mode';

type InpageDisplayMode = 'supported' | 'all' | 'off';

function normalizeInpageDisplayMode(value: unknown): InpageDisplayMode | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'supported' || raw === 'all' || raw === 'off') return raw as InpageDisplayMode;
  return null;
}

function displayModeFromLegacySupportedOnly(value: unknown): InpageDisplayMode {
  return value === true ? 'supported' : 'all';
}

const SUPPORTED_HOST_SUFFIXES = Object.freeze([
  'chat.openai.com',
  'chatgpt.com',
  'www.chatgpt.com',
  'claude.ai',
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

  try {
    inpageButton?.initRuntime?.(runtime);
  } catch (_e) {
    // ignore
  }

  const wrapper = input.createController();
  let active: { stop?: () => void } | null = null;

  function startController() {
    try {
      active = wrapper?.start?.() || null;
    } catch (_e) {
      active = null;
    }
    return active;
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

  const supportedHost = isSupportedHost(location?.hostname || '');

  const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;

  function readDisplayMode(): Promise<InpageDisplayMode> {
    return new Promise((resolve) => {
      try {
        const local = storageApi?.local;
        if (!local?.get) return resolve('all');
        local.get([STORAGE_KEY_DISPLAY_MODE, STORAGE_KEY_SUPPORTED_ONLY], (res: any) => {
          const normalized = normalizeInpageDisplayMode(res?.[STORAGE_KEY_DISPLAY_MODE]);
          if (normalized) return resolve(normalized);
          return resolve(displayModeFromLegacySupportedOnly(res?.[STORAGE_KEY_SUPPORTED_ONLY]));
        });
      } catch (_e) {
        resolve('all');
      }
    });
  }

  function applyDisplayMode(mode: InpageDisplayMode) {
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

  // Initial start decision.
  readDisplayMode()
    .then((mode) => applyDisplayMode(mode))
    .catch(() => applyDisplayMode('all'));

  return {
    stop() {
      stopController();
    },
  };
}
