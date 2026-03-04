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

const STORAGE_KEY = 'inpage_supported_only';

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

  function readSupportedOnly(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const local = storageApi?.local;
        if (!local?.get) return resolve(false);
        local.get([STORAGE_KEY], (res: any) => resolve(res?.[STORAGE_KEY] === true));
      } catch (_e) {
        resolve(false);
      }
    });
  }

  function applySupportedOnly(supportedOnly: boolean) {
    // supported sites always on (the setting means "supported sites only").
    if (supportedHost) {
      if (!active) startController();
      return;
    }

    if (supportedOnly) {
      if (active) stopController();
      return;
    }

    if (!active) startController();
  }

  // Initial start decision.
  if (supportedHost) {
    startController();
  } else {
    readSupportedOnly()
      .then((supportedOnly) => applySupportedOnly(supportedOnly))
      .catch(() => applySupportedOnly(false));
  }

  return {
    stop() {
      stopController();
    },
  };
}
