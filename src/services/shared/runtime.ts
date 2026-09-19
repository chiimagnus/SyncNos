import {
  getManifest as platformGetManifest,
  getURL as platformGetURL,
  sendMessage as platformSendMessage,
} from '@platform/runtime/runtime';

export async function send<TResponse = unknown>(type: string, payload?: Record<string, unknown>): Promise<TResponse> {
  if (!type) throw new Error('Message type is required');
  return platformSendMessage<TResponse>({ type, ...(payload ?? {}) });
}

export { platformGetURL as getURL, platformGetManifest as getManifest };
