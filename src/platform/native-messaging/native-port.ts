export type NativeMessagingPort = {
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: {
    addListener: (listener: (message: unknown) => void) => void;
  };
  onDisconnect: {
    addListener: (listener: () => void) => void;
  };
};

export type ExtensionRuntimeMetadata = {
  runtimeId: string;
  extensionVersion: string;
  browserFamily: 'chromium' | 'firefox' | 'unknown';
};

function runtimeApi(): any {
  const anyGlobal = globalThis as any;
  return anyGlobal.browser?.runtime ?? anyGlobal.chrome?.runtime ?? null;
}

export function detectNativeMessagingBrowserFamily(): ExtensionRuntimeMetadata['browserFamily'] {
  const userAgent = String(globalThis.navigator?.userAgent || '').toLowerCase();
  if (!userAgent) return 'unknown';
  if (userAgent.includes('firefox') || userAgent.includes('librewolf') || userAgent.includes('zen')) return 'firefox';
  if (
    userAgent.includes('chrome') ||
    userAgent.includes('chromium') ||
    userAgent.includes('edg/') ||
    userAgent.includes('helium')
  ) {
    return 'chromium';
  }
  return 'unknown';
}

export function connectNativeHost(hostName: string): NativeMessagingPort {
  const name = String(hostName || '').trim();
  if (!name) throw new Error('native host name is required');
  const runtime = runtimeApi();
  if (!runtime?.connectNative) throw new Error('runtime.connectNative unavailable');
  return runtime.connectNative(name) as NativeMessagingPort;
}

export function readExtensionRuntimeMetadata(): ExtensionRuntimeMetadata {
  const runtime = runtimeApi();
  return {
    runtimeId: String(runtime.id || ''),
    extensionVersion: String(runtime.getManifest().version || ''),
    browserFamily: detectNativeMessagingBrowserFamily(),
  };
}
