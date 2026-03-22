import { openOrFocusExtensionAppTab as platformOpenOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import { tabsCreate as platformTabsCreate } from '@platform/webext/tabs';

export const webext = {
  openOrFocusExtensionAppTab: platformOpenOrFocusExtensionAppTab,
  tabs: {
    create: platformTabsCreate,
  },
};

export { platformOpenOrFocusExtensionAppTab as openOrFocusExtensionAppTab, platformTabsCreate as tabsCreate };
