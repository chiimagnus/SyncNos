import { createHash } from 'node:crypto';

import type { DigestProvider } from '@services/local-data/digest';

export const nodeDigestProvider: DigestProvider = {
  async sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};
