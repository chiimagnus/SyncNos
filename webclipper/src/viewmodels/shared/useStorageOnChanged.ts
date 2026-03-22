import { useEffect } from 'react';

import { storageOnChanged } from '@services/shared/storage';

export function useStorageOnChanged(listener: (changes: any, areaName: string) => void) {
  useEffect(() => {
    return storageOnChanged(listener);
  }, [listener]);
}

