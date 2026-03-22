import {
  INVALIDATED_MESSAGE,
  getManifest as platformGetManifest,
  getURL as platformGetURL,
  isInvalidContextError as platformIsInvalidContextError,
  onInstalled as platformOnInstalled,
  onStartup as platformOnStartup,
  sendMessage as platformSendMessage,
} from '@platform/runtime/runtime';

export async function send<TResponse = unknown>(type: string, payload?: Record<string, unknown>): Promise<TResponse> {
  if (!type) throw new Error('Message type is required');
  return platformSendMessage<TResponse>({ type, ...(payload ?? {}) });
}

export const runtime = {
  send,
  sendMessage: platformSendMessage,
  getURL: platformGetURL,
  getManifest: platformGetManifest,
  onInstalled: platformOnInstalled,
  onStartup: platformOnStartup,
  isInvalidContextError: platformIsInvalidContextError,
  INVALIDATED_MESSAGE,
};

export {
  platformSendMessage as sendMessage,
  platformGetURL as getURL,
  platformGetManifest as getManifest,
  platformOnInstalled as onInstalled,
  platformOnStartup as onStartup,
  platformIsInvalidContextError as isInvalidContextError,
  INVALIDATED_MESSAGE,
};
