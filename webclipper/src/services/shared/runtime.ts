import {
  INVALIDATED_MESSAGE,
  getManifest as platformGetManifest,
  getURL as platformGetURL,
  isInvalidContextError as platformIsInvalidContextError,
  onInstalled as platformOnInstalled,
  onStartup as platformOnStartup,
  send as platformSend,
  sendMessage as platformSendMessage,
} from '@platform/runtime/runtime';

export const runtime = {
  send: platformSend,
  sendMessage: platformSendMessage,
  getURL: platformGetURL,
  getManifest: platformGetManifest,
  onInstalled: platformOnInstalled,
  onStartup: platformOnStartup,
  isInvalidContextError: platformIsInvalidContextError,
  INVALIDATED_MESSAGE,
};

export {
  platformSend as send,
  platformSendMessage as sendMessage,
  platformGetURL as getURL,
  platformGetManifest as getManifest,
  platformOnInstalled as onInstalled,
  platformOnStartup as onStartup,
  platformIsInvalidContextError as isInvalidContextError,
  INVALIDATED_MESSAGE,
};

