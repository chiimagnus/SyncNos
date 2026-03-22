import { useCallback } from 'react';

import { openOrFocusExtensionAppTab } from '@services/shared/webext';

export function useOpenExtensionAppTab() {
  return useCallback(async (route?: string) => {
    return await openOrFocusExtensionAppTab({ route });
  }, []);
}
