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

const WEB_INPAGE_VISIBILITY_MESSAGE = 'webclipperSetWebInpageEnabled';

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

  startController();

  const runtimeApi = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  try {
    runtimeApi?.onMessage?.addListener?.((msg: any, _sender: any, sendResponse: any) => {
      if (!msg || msg.type !== WEB_INPAGE_VISIBILITY_MESSAGE) return;

      if (isSupportedHost(location?.hostname || '')) {
        try {
          sendResponse?.({ ok: true, ignored: true });
        } catch (_e) {
          // ignore
        }
        return;
      }

      const enabled = msg.enabled === true;
      if (enabled) {
        if (!active) startController();
      } else if (active) {
        stopController();
      }

      try {
        sendResponse?.({ ok: true, enabled });
      } catch (_e) {
        // ignore
      }
    });
  } catch (_e) {
    // ignore
  }

  return {
    stop() {
      stopController();
    },
  };
}
