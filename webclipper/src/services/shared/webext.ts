import { openOrFocusExtensionAppTab as platformOpenOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import {
  tabsCreate as platformTabsCreate,
  tabsGet as platformTabsGet,
  tabsQuery as platformTabsQuery,
  tabsRemove as platformTabsRemove,
  tabsSendMessage as platformTabsSendMessage,
  tabsUpdate as platformTabsUpdate,
} from '@platform/webext/tabs';

export const webext = {
  openOrFocusExtensionAppTab: platformOpenOrFocusExtensionAppTab,
  tabs: {
    create: platformTabsCreate,
    get: platformTabsGet,
    query: platformTabsQuery,
    update: platformTabsUpdate,
    sendMessage: platformTabsSendMessage,
    remove: platformTabsRemove,
  },
};

export {
  platformOpenOrFocusExtensionAppTab as openOrFocusExtensionAppTab,
  platformTabsCreate as tabsCreate,
  platformTabsGet as tabsGet,
  platformTabsQuery as tabsQuery,
  platformTabsUpdate as tabsUpdate,
  platformTabsSendMessage as tabsSendMessage,
  platformTabsRemove as tabsRemove,
};

